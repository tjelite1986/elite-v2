import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { db } from "./db";
import { handleOf } from "./directory";
import { setProfileInstagram } from "./profiles";
import { storeAvatar } from "./posts-storage";

// Instagram cookie-based info-sync + media poll, driven per profile. A profile
// stores its Instagram source (profile_extras.instagram_handle); syncing pulls
// that IG account's media into the profile's local handle so photos become the
// profile's posts and videos its shorts (via scripts/instagram-sync.mjs +
// import-posts.mjs). A Netscape cookies.txt grants logged-in scrape mode.

const COOKIES_PATH =
  process.env.IG_COOKIES_PATH || "/instagram-store/cookies.txt";

// --- Cookie file ----------------------------------------------------------

export function cookiesFilePath(): string {
  return COOKIES_PATH;
}

export function hasCookies(): boolean {
  try {
    return fs.statSync(COOKIES_PATH).size > 0;
  } catch {
    return false;
  }
}

// Run the Instaloader sidecar (scripts/ig_profile.py). Instaloader is IG-
// specialized and self-paces (RateController), so it survives the rate limits a
// raw web_profile_info loop trips. Returns stdout, or null on failure. `input`
// feeds stdin (batch mode).
function runIgPython(args: string[], input?: string): string | null {
  const script = path.join(process.cwd(), "scripts", "ig_profile.py");
  const env = {
    ...process.env,
    // Instaloader/requests want a writable HOME for any cache; the nextjs user
    // has none (/nonexistent).
    HOME:
      process.env.HOME && fs.existsSync(process.env.HOME)
        ? process.env.HOME
        : os.tmpdir(),
  };
  try {
    return execFileSync("python3", [script, ...args], {
      encoding: "utf8",
      input,
      env,
      timeout: 280_000,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    const e = err as { stdout?: string };
    return e.stdout ? String(e.stdout) : null;
  }
}

// Normalized IG profile, or null on request failure. `exists:false` means the
// account genuinely doesn't exist (distinct from a transient failure → null).
interface IgUser {
  exists: boolean;
  username: string | null;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  postCount: number | null;
  links: string[];
}

function parseIgUser(json: Record<string, unknown>): IgUser {
  return {
    exists: json.exists === true,
    username: typeof json.username === "string" ? json.username : null,
    displayName: typeof json.full_name === "string" ? json.full_name : null,
    bio: typeof json.biography === "string" ? json.biography : null,
    avatarUrl: typeof json.profile_pic_url === "string" ? json.profile_pic_url : null,
    postCount: typeof json.mediacount === "number" ? json.mediacount : null,
    links: Array.isArray(json.links) ? (json.links as string[]) : [],
  };
}

// Fetch one IG profile via Instaloader. null = request failed (rate-limit/
// network); an object with exists:false = the account doesn't exist.
function igUser(username: string): IgUser | null {
  const out = runIgPython(["user", username]);
  if (!out) return null;
  const last = out.trim().split("\n").pop();
  if (!last) return null;
  try {
    const d = JSON.parse(last) as Record<string, unknown>;
    if (d.error) return null;
    return parseIgUser(d);
  } catch {
    return null;
  }
}

// Whether the saved session is still valid (Instagram rotates cookies every few
// weeks). Uses Instaloader's test_login — accurate, unlike file-presence.
export function cookiesAlive(): boolean {
  if (!hasCookies()) return false;
  const out = runIgPython(["login-check"]);
  if (!out) return false;
  const last = out.trim().split("\n").pop();
  if (!last) return false;
  try {
    const d = JSON.parse(last) as { username?: string };
    return !!d.username;
  } catch {
    return false;
  }
}

// --- Username parsing -----------------------------------------------------

// Accept a bare @username or any instagram.com/<username>/... URL.
export function parseInstagramUsername(input: string): string | null {
  const raw = String(input || "").trim();
  if (!raw) return null;
  let name = raw;
  const urlMatch = raw.match(/instagram\.com\/([^/?#]+)/i);
  if (urlMatch) name = urlMatch[1];
  name = name.replace(/^@/, "").trim();
  if (!/^[A-Za-z0-9._]{1,30}$/.test(name)) return null;
  return name.toLowerCase();
}

// --- Info sync ------------------------------------------------------------

// True only when an Instagram account with EXACTLY this username exists — used by
// auto-connect to link a posts folder to IG only on a 100% match. Returns false
// on a transient failure too, so a wrong account is never linked.
export function instagramAccountExists(username: string): boolean {
  const u = igUser(username);
  return !!u && u.exists && (u.username ?? "").toLowerCase() === username.toLowerCase();
}

// Fetch IG profile metadata (via Instaloader) and apply it to the LOCAL profile
// identified by targetHandle: refresh its avatar, creator name/bio, and links.
export async function fetchProfileInfo(
  igUsername: string,
  targetHandle: string
): Promise<{
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  postCount: number | null;
} | null> {
  const user = igUser(igUsername);
  if (!user || !user.exists) return null;

  const meta = {
    displayName: user.displayName,
    bio: user.bio,
    avatarUrl: user.avatarUrl,
    postCount: user.postCount,
    links: user.links,
  };

  await applyToPeople(targetHandle, meta);
  return meta;
}

// Apply fetched IG metadata to the local profile (by handle). For a creator-
// backed profile (the common case) the IG name/bio fill the post_creators mirror
// (IG wins, but resolvePerson still prefers a curated profile_extras.bio over
// it). The avatar is set on the handle (shown everywhere) and IG bio links are
// merged into the profile's links. Real user accounts only get the avatar — we
// never overwrite a person's own name/bio. Best effort.
async function applyToPeople(
  targetHandle: string,
  meta: {
    displayName: string | null;
    bio: string | null;
    avatarUrl: string | null;
    links?: string[];
  }
): Promise<void> {
  const handle = handleOf(targetHandle);
  if (!handle) return;
  try {
    const isUser = db
      .prepare("SELECT 1 FROM user_profiles WHERE username = ?")
      .get(handle);
    if (!isUser) {
      const creator = db
        .prepare("SELECT id FROM post_creators WHERE username = ?")
        .get(handle) as { id: number } | undefined;
      if (creator) {
        db.prepare(
          "UPDATE post_creators SET display_name = COALESCE(?, display_name), bio = COALESCE(?, bio) WHERE id = ?"
        ).run(meta.displayName, meta.bio, creator.id);
      } else {
        db.prepare(
          "INSERT INTO post_creators (username, display_name, bio, source) VALUES (?, ?, ?, 'instagram')"
        ).run(handle, meta.displayName, meta.bio);
      }
    }

    if (meta.avatarUrl) {
      const buf = downloadToBuffer(meta.avatarUrl);
      if (buf && buf.length > 0) {
        const key = await storeAvatar("avatar.jpg", "image/jpeg", buf);
        db.prepare(
          `INSERT INTO handle_avatars (handle, avatar_key, updated_at)
           VALUES (?, ?, datetime('now'))
           ON CONFLICT(handle) DO UPDATE SET avatar_key = excluded.avatar_key, updated_at = excluded.updated_at`
        ).run(handle, key);
      }
    }

    if (meta.links && meta.links.length) mergeProfileLinks(handle, meta.links);
  } catch (err) {
    console.error("[instagram] applyToPeople failed:", err);
  }
}

// Merge IG bio links into profile_extras.links_json without dropping curated
// ones (dedup by URL, http(s) only, capped at 10).
function mergeProfileLinks(handle: string, urls: string[]): void {
  const row = db
    .prepare("SELECT links_json FROM profile_extras WHERE handle = ?")
    .get(handle) as { links_json: string | null } | undefined;
  let links: { label: string; url: string }[] = [];
  try {
    const parsed = row?.links_json ? JSON.parse(row.links_json) : [];
    if (Array.isArray(parsed)) {
      links = parsed.filter((l) => l && typeof l.url === "string");
    }
  } catch {
    /* bad json -> start fresh */
  }
  const seen = new Set(links.map((l) => l.url));
  for (const raw of urls) {
    const url = (raw || "").trim().slice(0, 300);
    if (!/^https?:\/\//i.test(url) || seen.has(url) || links.length >= 10) continue;
    seen.add(url);
    links.push({ label: "", url });
  }
  db.prepare(
    `INSERT INTO profile_extras (handle, links_json, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(handle) DO UPDATE SET links_json = excluded.links_json, updated_at = excluded.updated_at`
  ).run(handle, JSON.stringify(links.slice(0, 10)));
}

function downloadToBuffer(url: string): Buffer | null {
  try {
    return execFileSync(
      "curl",
      ["-s", "-L", "--max-time", "20", "-A", "Mozilla/5.0", url],
      { maxBuffer: 32 * 1024 * 1024, timeout: 25_000 }
    );
  } catch {
    return null;
  }
}

// --- Media poll -----------------------------------------------------------

// Auto-connect post-creator folders to Instagram where the folder name is a
// real IG account with the exact same name (100% match). Skips creators already
// connected. Verifies existence via Instaloader in ONE batched process so its
// RateController paces across the whole batch (instead of tripping the rate
// limit a per-request loop hits). Bounded per call — returns counts so the
// caller can run it again for the rest.
export function autoConnectInstagram(limit = 40): {
  candidates: number;
  checked: number;
  connected: number;
  remaining: number;
} {
  const rows = db
    .prepare(
      `SELECT pc.username AS handle
         FROM post_creators pc
         LEFT JOIN profile_extras pe ON pe.handle = pc.username
        WHERE (pe.instagram_handle IS NULL OR pe.instagram_handle = '')
        ORDER BY pc.username`
    )
    .all() as { handle: string }[];
  const candidates = rows
    .map((r) => r.handle)
    .filter((h) => /^[a-z0-9._]{1,30}$/.test(h));

  const batch = candidates.slice(0, limit);
  let checked = 0;
  let connected = 0;
  if (batch.length > 0) {
    const out = runIgPython(["batch"], batch.join("\n"));
    if (out) {
      for (const line of out.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        let d: Record<string, unknown>;
        try {
          d = JSON.parse(t) as Record<string, unknown>;
        } catch {
          continue;
        }
        checked++;
        if (d.exists === true && typeof d.username === "string") {
          setProfileInstagram(d.username, d.username, false);
          connected++;
        }
      }
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

// Fire the media downloader for one profile (by local handle) or, when handle is
// null, for every profile with ig_auto_poll=1. Detached + unref so it survives
// the HTTP response; the script reads each profile's instagram_handle from the
// DB, downloads into the profile's import folder, and ingests. A lockfile
// serializes it against the scheduled timer.
export function triggerSync(handle: string | null, mode: SyncMode): void {
  try {
    const script = path.join(process.cwd(), "scripts", "instagram-sync.mjs");
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
    console.error("[instagram] failed to trigger sync:", err);
  }
}
