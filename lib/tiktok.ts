import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Async exec: a synchronous gallery-dl call here would freeze the whole
// single-process server (HTTP, websockets and the job scheduler) for up to the
// full timeout.
const execFileAsync = promisify(execFile);
import { qb, getAll } from "./kysely";
import { setProfileTiktok } from "./profiles";
import { applyToPeople } from "./instagram";

// TikTok info-sync + media poll, driven per profile. A profile stores its
// TikTok source (profile_extras.tiktok_handle); syncing pulls that account's
// media into the profile's local handle so videos become the profile's shorts
// (and photo posts become posts) via scripts/tiktok-sync.mjs + the shared
// import pipeline.
//
// CRITICAL difference from Instagram: TikTok cookies are OPTIONAL. We download
// from the PUBLIC profile and only pass `--cookies <file>` to gallery-dl/yt-dlp
// when a cookie file actually exists. A missing cookie never blocks a sync.

const GALLERY_DL = process.env.GALLERY_DL_BIN || "gallery-dl";

// Optional Netscape cookies.txt, analogous to Instagram's. Present = used,
// absent = public download (no gating). Defaults match the container-mounted
// store path style used for Instagram (host /mnt/4tb/elitev2/tiktok).
const COOKIES_PATH =
  process.env.TIKTOK_COOKIES_PATH ||
  path.join(process.env.TIKTOK_COOKIES_ROOT || "/tiktok-store", "cookies.txt");

// Path to the optional cookie file if it exists on disk, else null. Used to
// decide whether to add `--cookies` — never a precondition for syncing.
export function tiktokCookiePath(): string | null {
  try {
    if (fs.statSync(COOKIES_PATH).isFile()) return COOKIES_PATH;
  } catch {
    /* no cookie file -> public download */
  }
  return null;
}

export function hasCookies(): boolean {
  return tiktokCookiePath() !== null;
}

// --- Username parsing -----------------------------------------------------

// Accept a bare @username, a plain username, or any tiktok.com/@<username>/...
// URL. TikTok handles are 2-24 chars of [A-Za-z0-9._]; returned lowercased.
export function parseTiktokUsername(input: string): string | null {
  const raw = String(input || "").trim();
  if (!raw) return null;
  let name = raw;
  const urlMatch = raw.match(/tiktok\.com\/@([^/?#]+)/i);
  if (urlMatch) name = urlMatch[1];
  name = name.replace(/^@/, "").trim();
  if (!/^[A-Za-z0-9._]{1,24}$/.test(name)) return null;
  return name.toLowerCase();
}

// --- Profile fetch (best-effort, cookie-optional) -------------------------

interface TtUser {
  exists: boolean;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

// Pull the first item of a TikTok profile via gallery-dl (-j) and read the
// author metadata from it. gallery-dl's TikTok support is light, so this is
// best-effort: null on any failure. Cookie is added only when present.
async function ttUser(handle: string): Promise<TtUser | null> {
  const url = `https://www.tiktok.com/@${encodeURIComponent(handle)}`;
  const args = ["-j", "--range", "1-1"];
  const cookie = tiktokCookiePath();
  if (cookie) args.push("--cookies", cookie);
  args.push(url);

  const env = {
    ...process.env,
    HOME:
      process.env.HOME && fs.existsSync(process.env.HOME)
        ? process.env.HOME
        : os.tmpdir(),
  };
  let out: string;
  try {
    const res = await execFileAsync(GALLERY_DL, args, {
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
      env,
    });
    out = res.stdout;
  } catch (err) {
    const e = err as { stdout?: string };
    if (!e.stdout) return null;
    out = String(e.stdout);
  }
  let data: unknown;
  try {
    data = JSON.parse(out);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;
  for (const entry of data) {
    const meta = Array.isArray(entry) ? entry[entry.length - 1] : null;
    if (!meta || typeof meta !== "object") continue;
    const m = meta as Record<string, unknown>;
    const username =
      (m.author as string) ||
      (m.user as string) ||
      (m.uploader as string) ||
      handle;
    const displayName =
      (m.nickname as string) ||
      (m.author_name as string) ||
      (m.uploader as string) ||
      null;
    const avatarUrl =
      (m.avatar as string) ||
      (m.avatarLarger as string) ||
      (m.avatar_url as string) ||
      null;
    if (username || displayName || avatarUrl) {
      return {
        exists: true,
        username: typeof username === "string" ? username : handle,
        displayName: typeof displayName === "string" ? displayName : null,
        avatarUrl: typeof avatarUrl === "string" ? avatarUrl : null,
      };
    }
  }
  // Reaching here means the request resolved but carried no author metadata —
  // typically a blocked or rate-limited scrape. Treat as unknown so existence
  // checks (auto-connect) never link an unverified account.
  return null;
}

// True when a TikTok account for this handle is reachable. Best-effort; returns
// false on a transient failure so auto-connect never links a wrong account.
export async function tiktokAccountExists(handle: string): Promise<boolean> {
  const u = await ttUser(handle);
  return !!u && u.exists;
}

// Fetch TikTok profile metadata and apply it to the LOCAL profile identified by
// targetHandle (refresh name + avatar). Reuses the shared applyToPeople helper
// from lib/instagram.ts so the two syncs never drift. TikTok post metadata has
// no bio/links, so those stay null (COALESCE keeps any curated values).
export async function fetchProfileInfo(
  tiktokUsername: string,
  targetHandle: string
): Promise<{
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  postCount: number | null;
} | null> {
  const user = await ttUser(tiktokUsername);
  if (!user || !user.exists) return null;

  const meta = {
    displayName: user.displayName,
    bio: null as string | null,
    avatarUrl: user.avatarUrl,
    postCount: null as number | null,
  };

  await applyToPeople(targetHandle, meta, "tiktok");
  return meta;
}

// --- Auto-connect ----------------------------------------------------------

// Auto-connect post-creator folders to TikTok where the folder name is a real
// TikTok account. Skips creators already connected. Bounded per call — returns
// counts so the caller can run it again for the rest.
export async function autoConnectTiktok(limit = 40): Promise<{
  candidates: number;
  checked: number;
  connected: number;
  remaining: number;
}> {
  const rows = getAll<{ handle: string }>(
    qb
      .selectFrom("post_creators as pc")
      .leftJoin("profile_extras as pe", "pe.handle", "pc.username")
      .select("pc.username as handle")
      .where((eb) =>
        eb.or([
          eb("pe.tiktok_handle", "is", null),
          eb("pe.tiktok_handle", "=", ""),
        ])
      )
      .orderBy("pc.username")
  );
  const candidates = rows
    .map((r) => r.handle)
    .filter((h) => /^[a-z0-9._]{1,24}$/.test(h));

  const batch = candidates.slice(0, limit);
  let checked = 0;
  let connected = 0;
  for (const handle of batch) {
    checked++;
    if (await tiktokAccountExists(handle)) {
      setProfileTiktok(handle, handle, false);
      connected++;
    }
  }
  return {
    candidates: candidates.length,
    checked,
    connected,
    remaining: Math.max(0, candidates.length - batch.length),
  };
}

export type SyncMode = "all" | "photos";

// Fire the media downloader for one profile (by local handle) or, when handle
// is null, for every profile with tt_auto_poll=1. Detached + unref so it
// survives the HTTP response; the script reads each profile's tiktok_handle
// from the DB, downloads into the profile's import folder, and ingests. A
// lockfile serializes it against the scheduled timer.
export function triggerSync(handle: string | null, mode: SyncMode): void {
  try {
    const script = path.join(process.cwd(), "scripts", "tiktok-sync.mjs");
    const args = [script];
    if (handle) args.push(handle);
    args.push(`--mode=${mode === "photos" ? "photos" : "all"}`);
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: "ignore",
      cwd: process.cwd(),
    });
    child.unref();
  } catch (err) {
    console.error("[tiktok] failed to trigger sync:", err);
  }
}
