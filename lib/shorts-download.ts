import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { db, ShortProfileRow } from "./db";
import { qb, getOne, getAll } from "./kysely";
import { channelDir, profileSlug } from "./shorts-storage";

const YT_DLP = process.env.YT_DLP_BIN || "yt-dlp";

// True for addresses we must never let the downloader reach (SSRF guard):
// loopback, RFC1918 private ranges, link-local and IPv6 equivalents.
function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 127) return true; // this-host / loopback
    if (a === 10) return true; // 10/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 169 && b === 254) return true; // 169.254/16 link-local
    return false;
  }
  const ip6 = ip.toLowerCase();
  if (ip6 === "::1" || ip6 === "::") return true; // loopback / unspecified
  if (ip6.startsWith("fe80")) return true; // link-local
  if (ip6.startsWith("fc") || ip6.startsWith("fd")) return true; // unique-local
  const mapped = ip6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]); // IPv4-mapped IPv6
  return false;
}

// Validate a user-supplied download URL before handing it to yt-dlp. We keep the
// "works on most sites" behaviour (no host allowlist) but block the SSRF vector:
// only http(s), and the host must not resolve to a private/loopback address.
// Note: this does not defend against DNS rebinding mid-download — acceptable
// here as the endpoint is admin-only.
export async function assertDownloadableUrl(raw: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Invalid URL.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http(s) URLs are supported.");
  }
  const addrs = await lookup(u.hostname, { all: true });
  if (addrs.length === 0) throw new Error("Could not resolve host.");
  for (const a of addrs) {
    if (isPrivateAddress(a.address)) {
      throw new Error("URL resolves to a non-public address.");
    }
  }
}

export interface Candidate {
  id: string;
  title: string | null;
  url: string;
  thumbnail: string | null;
  duration: number | null;
  view_count: number | null;
  downloaded: boolean;
}

// Turn a raw yt-dlp stderr dump into a short, user-facing reason.
function friendlyYtdlpError(stderr: string): string {
  const s = stderr.toLowerCase();
  if (s.includes("private") || s.includes("embedding disabled")) {
    return "This account is private or has embedding disabled, so its videos can't be listed.";
  }
  if (s.includes("not found") || s.includes("404") || s.includes("unable to extract")) {
    return "Couldn't read this source — the account may be private, renamed, or removed.";
  }
  if (s.includes("rate") || s.includes("429") || s.includes("captcha")) {
    return "The source is rate-limiting requests right now. Try again in a while.";
  }
  return "Could not list videos for this source.";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bestThumb(entry: any): string | null {
  if (typeof entry.thumbnail === "string") return entry.thumbnail;
  const thumbs = Array.isArray(entry.thumbnails) ? entry.thumbnails : [];
  if (thumbs.length === 0) return null;
  const withUrl = thumbs.filter((t: { url?: string }) => t.url);
  if (withUrl.length === 0) return null;
  // Prefer the largest by width; fall back to the last entry.
  withUrl.sort(
    (a: { width?: number }, b: { width?: number }) => (a.width || 0) - (b.width || 0)
  );
  return withUrl[withUrl.length - 1].url;
}

// List the latest available clips for a profile (newest first) with thumbnail +
// meta, flagging which are already imported. Enumerates with yt-dlp flat mode so
// it's a single fast network call.
export function enumerateCandidates(
  profile: ShortProfileRow,
  limit: number
): Candidate[] {
  let out = "";
  try {
    out = execFileSync(
      YT_DLP,
      [
        "--flat-playlist",
        "--dump-json",
        "--playlist-end", String(limit),
        "--no-warnings",
        profile.source_ref,
      ],
      { encoding: "utf8", maxBuffer: 128 * 1024 * 1024, timeout: 60_000 }
    );
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    out = e.stdout ? String(e.stdout) : "";
    if (!out) throw new Error(friendlyYtdlpError(String(e.stderr || "")));
  }

  const known = new Set(
    getAll<{ source_id: string | null }>(
      qb
        .selectFrom("shorts")
        .select("source_id")
        .where("profile_id", "=", profile.id)
        .where("source_id", "is not", null)
    ).map((r) => r.source_id)
  );

  const items: Candidate[] = [];
  for (const line of out.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const e = JSON.parse(t);
      const id = e.id ? String(e.id) : null;
      if (!id) continue;
      let url = typeof e.url === "string" ? e.url : e.webpage_url;
      if (!url && /youtube/i.test(e.ie_key || e.extractor || "")) {
        url = `https://www.youtube.com/watch?v=${id}`;
      }
      if (!url) continue;
      items.push({
        id,
        title: e.title || null,
        url,
        thumbnail: bestThumb(e),
        duration: typeof e.duration === "number" ? e.duration : null,
        view_count: typeof e.view_count === "number" ? e.view_count : null,
        downloaded: known.has(id),
      });
    } catch {
      /* skip */
    }
  }
  return items;
}

// Download a single clip into the profile's folder and insert a 'pending' short
// (the transcoder turns it into .web.mp4). Returns the new short id, or null on
// failure / if it already exists.
export function downloadOne(
  profile: ShortProfileRow,
  videoUrl: string,
  sourceId: string,
  title: string | null
): number | null {
  if (
    getOne(
      qb
        .selectFrom("shorts")
        .select("id")
        .where("profile_id", "=", profile.id)
        .where("source_id", "=", sourceId)
    )
  ) {
    return null; // already imported
  }

  const slug = profileSlug(profile.name);
  const dir = path.join(channelDir(profile.channel), slug);
  fs.mkdirSync(dir, { recursive: true });
  const uuid = randomUUID();

  execFileSync(
    YT_DLP,
    [
      "--no-playlist",
      "-f", "best[height<=1920][ext=mp4]/best[height<=1920]/best",
      "--merge-output-format", "mp4",
      "-o", path.join(dir, `${uuid}.%(ext)s`),
      "--no-warnings", "--no-progress", "--quiet",
      videoUrl,
    ],
    { stdio: "ignore", timeout: 5 * 60 * 1000 }
  );

  const produced = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(`${uuid}.`) && !f.endsWith(".part"));
  if (produced.length === 0) return null;

  const result = db
    .prepare(
      `INSERT INTO shorts
         (channel, profile_id, uploader_id, caption, storage_key, poster_key,
          mime_type, source, source_id, status)
       VALUES (?, ?, NULL, ?, ?, NULL, 'video/mp4', 'poll', ?, 'pending')`
    )
    .run(
      profile.channel,
      profile.id,
      title,
      `${slug}/${produced[0]}`,
      sourceId
    );
  return Number(result.lastInsertRowid);
}
