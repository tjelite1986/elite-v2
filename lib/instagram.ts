import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { db } from "./db";
import { qb, getOne, getAll } from "./kysely";
import { handleOf } from "./directory";
import { setProfileInstagram } from "./profiles";
import { storeAvatar } from "./posts-storage";
import { safeHttpUrl } from "./url";

// Instagram cookie-based info-sync + media poll, driven per profile. A profile
// stores its Instagram source (profile_extras.instagram_handle); syncing pulls
// that IG account's media into the profile's local handle so photos become the
// profile's posts and videos its shorts (via scripts/instagram-sync.mjs +
// import-posts.mjs). A Netscape cookies.txt grants logged-in scrape mode.

const COOKIES_ROOT = process.env.IG_COOKIES_ROOT || "/instagram-store";
const COOKIES_PATH =
  process.env.IG_COOKIES_PATH || path.join(COOKIES_ROOT, "cookies.txt");
const COOLDOWN_FILE = path.join(os.tmpdir(), "elitev2-ig-cooldowns.json");

const GALLERY_DL = process.env.GALLERY_DL_BIN || "gallery-dl";

// --- Cookie pool ----------------------------------------------------------
// Several IG accounts can be rotated: the root cookies.txt (id "default") plus
// one cookies.txt per immediate subfolder of IG_COOKIES_ROOT (id = folder name).
// Discovery + ordering MUST match scripts/ig_profile.py and
// scripts/instagram-sync.mjs (sorted by id with plain codepoint comparison,
// deduped by realpath) so the heavy poller's sticky hashing stays stable.

export interface CookieMember {
  id: string;
  path: string;
}

function sanitizeCookieId(name: string): string {
  const s = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
  return s || "default";
}

export function listCookiePool(): CookieMember[] {
  const out: CookieMember[] = [];
  const seen = new Set<string>();
  const add = (id: string, p: string) => {
    try {
      if (!fs.statSync(p).isFile()) return;
    } catch {
      return;
    }
    let rp = p;
    try {
      rp = fs.realpathSync(p);
    } catch {
      /* keep p */
    }
    if (seen.has(rp)) return;
    seen.add(rp);
    out.push({ id, path: p });
  };
  add("default", COOKIES_PATH);
  try {
    for (const name of fs.readdirSync(COOKIES_ROOT).sort()) {
      if (!/^[A-Za-z0-9._-]+$/.test(name)) continue;
      const d = path.join(COOKIES_ROOT, name);
      let st: fs.Stats;
      try {
        st = fs.statSync(d);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      const pref = path.join(d, "cookies.txt");
      if (fs.existsSync(pref)) {
        add(sanitizeCookieId(name), pref);
      } else {
        const txts = fs.readdirSync(d).filter((f) => f.endsWith(".txt")).sort();
        if (txts.length) add(sanitizeCookieId(name), path.join(d, txts[0]));
      }
    }
  } catch {
    /* root may not exist */
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

function readCooldowns(): Record<string, { until: number }> {
  try {
    const d = JSON.parse(fs.readFileSync(COOLDOWN_FILE, "utf8"));
    return d && typeof d === "object" ? d : {};
  } catch {
    return {};
  }
}

// First non-cooling pool member (for light single fetches), or the first member.
function firstEligibleCookie(): CookieMember | null {
  const pool = listCookiePool();
  if (!pool.length) return null;
  const cd = readCooldowns();
  const now = Date.now();
  return pool.find((m) => !(cd[m.id] && cd[m.id].until > now)) || pool[0];
}

// --- Cookie file (legacy single path, for display) ------------------------

export function cookiesFilePath(): string {
  return COOKIES_PATH;
}

export function hasCookies(): boolean {
  return listCookiePool().length > 0;
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

// Fetch one IG profile. Tries Instaloader first; on failure falls back to
// gallery-dl, because Instagram now 403-blocks Instaloader's graphql profile
// query even with a valid session. null = couldn't fetch.
function igUser(username: string): IgUser | null {
  const out = runIgPython(["user", username]);
  if (out) {
    const last = out.trim().split("\n").pop();
    if (last) {
      try {
        const d = JSON.parse(last) as Record<string, unknown>;
        if (!d.error) return parseIgUser(d);
      } catch {
        /* fall through to gallery-dl */
      }
    }
  }
  return igUserViaGalleryDl(username);
}

// Fallback profile fetch via gallery-dl: it reaches the owner's name + avatar
// through the posts feed (no graphql 403). Bio is profile-level and not in post
// metadata, so it stays null (applyToPeople keeps the existing bio via COALESCE).
function igUserViaGalleryDl(username: string): IgUser | null {
  const url = `https://www.instagram.com/${encodeURIComponent(username)}/posts/`;
  const cookiePath = firstEligibleCookie()?.path || COOKIES_PATH;
  const args = ["-j", "--range", "1-1", "--cookies", cookiePath, url];
  let out: string;
  try {
    out = execFileSync(GALLERY_DL, args, {
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    });
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
    const name = (m.full_name ?? m.fullname) as string | undefined;
    const pic = m.profile_pic_url as string | undefined;
    if (name || pic) {
      return {
        exists: true,
        username: (m.username as string) || username,
        displayName: name || null,
        bio: (m.biography as string) || null,
        avatarUrl: pic || null,
        postCount: null,
        links: [],
      };
    }
  }
  return null;
}

// Per-cookie session status (mirrors scripts/ig_profile.py `pool-status`).
export interface CookieStatus {
  id: string;
  alive: boolean;
  username: string;
  cooling: boolean;
  cooling_until?: number | null;
}

// Cache the live pool status so the admin manage page polling it doesn't spawn a
// graphql test_login per cookie on every request — that endpoint is what
// Instagram throttles ("Please wait a few minutes"). A positive result is held
// longer than a negative one. Keyed by a pool signature (ids + mtimes) so a
// freshly dropped/rotated cookie file re-checks at once.
let statusCache: { sig: string; value: CookieStatus[]; expires: number } | null =
  null;
const ALIVE_POS_TTL = 30 * 60 * 1000; // 30 min
const ALIVE_NEG_TTL = 5 * 60 * 1000; //  5 min

function poolSignature(): string {
  return listCookiePool()
    .map((m) => {
      let mt = 0;
      try {
        mt = fs.statSync(m.path).mtimeMs;
      } catch {
        /* ignore */
      }
      return `${m.id}:${mt}`;
    })
    .join("|");
}

// Guards against spawning more than one pool-status check at a time.
let statusRefreshing = false;

// Refresh the pool-status cache in the BACKGROUND. pool-status shells out to
// Instaloader's test_login, which can hang for minutes when Instagram is slow;
// running it synchronously on the request path froze the whole Node event loop
// (one stuck `ig_profile.py pool-status` = the entire app stops responding). So
// we spawn it async, cap it with a hard kill timeout, and only update the cache
// on success — callers always get the last known value immediately.
function refreshPoolStatusAsync(sig: string): void {
  if (statusRefreshing) return;
  statusRefreshing = true;
  const script = path.join(process.cwd(), "scripts", "ig_profile.py");
  const env = {
    ...process.env,
    HOME:
      process.env.HOME && fs.existsSync(process.env.HOME)
        ? process.env.HOME
        : os.tmpdir(),
  };
  let out = "";
  try {
    const child = spawn("python3", [script, "pool-status"], { env });
    const killer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }, 45_000);
    child.stdout?.on("data", (d) => {
      out += d.toString();
    });
    child.on("error", () => {
      clearTimeout(killer);
      statusRefreshing = false;
    });
    child.on("close", () => {
      clearTimeout(killer);
      statusRefreshing = false;
      const last = out.trim().split("\n").pop();
      try {
        const parsed = JSON.parse(last || "[]");
        if (Array.isArray(parsed)) {
          const value = parsed as CookieStatus[];
          const anyAlive = value.some((e) => e.alive);
          statusCache = {
            sig,
            value,
            expires: Date.now() + (anyAlive ? ALIVE_POS_TTL : ALIVE_NEG_TTL),
          };
        }
      } catch {
        /* keep the previous cache on parse failure */
      }
    });
  } catch {
    statusRefreshing = false;
  }
}

// Live status of every pool cookie (alive / cooling / username), cached. Never
// blocks: a stale/missing cache triggers a background refresh and returns the
// last known value (empty until the first refresh completes).
export function cookiePoolStatus(): CookieStatus[] {
  if (!hasCookies()) return [];
  const sig = poolSignature();
  const now = Date.now();
  if (statusCache && statusCache.sig === sig && now < statusCache.expires) {
    return statusCache.value;
  }
  refreshPoolStatusAsync(sig);
  return statusCache?.value ?? [];
}

// Whether ANY pool cookie still has a valid session (Instagram rotates cookies
// every few weeks). Uses Instaloader's test_login via pool-status — accurate,
// unlike file-presence.
export function cookiesAlive(): boolean {
  if (!hasCookies()) return false;
  return cookiePoolStatus().some((e) => e.alive);
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
// `source` records where a freshly created post_creators row originated
// ('instagram' by default; the TikTok sync passes 'tiktok'). Exported so
// lib/tiktok.ts reuses the exact same name/bio/avatar/link application logic.
export async function applyToPeople(
  targetHandle: string,
  meta: {
    displayName: string | null;
    bio: string | null;
    avatarUrl: string | null;
    links?: string[];
  },
  source = "instagram"
): Promise<void> {
  const handle = handleOf(targetHandle);
  if (!handle) return;
  try {
    const isUser = getOne(
      qb.selectFrom("user_profiles").select("user_id").where("username", "=", handle)
    );
    if (!isUser) {
      const creator = getOne<{ id: number }>(
        qb.selectFrom("post_creators").select("id").where("username", "=", handle)
      );
      if (creator) {
        db.prepare(
          "UPDATE post_creators SET display_name = COALESCE(?, display_name), bio = COALESCE(?, bio) WHERE id = ?"
        ).run(meta.displayName, meta.bio, creator.id);
      } else {
        db.prepare(
          "INSERT INTO post_creators (username, display_name, bio, source) VALUES (?, ?, ?, ?)"
        ).run(handle, meta.displayName, meta.bio, source);
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
  const row = getOne<{ links_json: string | null }>(
    qb.selectFrom("profile_extras").select("links_json").where("handle", "=", handle)
  );
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
  // Reject non-http(s) URLs and pass "--" so curl can't read a URL that starts
  // with "-" as a flag (argument injection); the avatar URL comes from a remote
  // API response, so treat it as untrusted.
  const safe = safeHttpUrl(url);
  if (!safe) return null;
  try {
    return execFileSync(
      "curl",
      ["-s", "-L", "--max-time", "20", "-A", "Mozilla/5.0", "--", safe],
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
  const rows = getAll<{ handle: string }>(
    qb
      .selectFrom("post_creators as pc")
      .leftJoin("profile_extras as pe", "pe.handle", "pc.username")
      .select("pc.username as handle")
      .where((eb) =>
        eb.or([
          eb("pe.instagram_handle", "is", null),
          eb("pe.instagram_handle", "=", ""),
        ])
      )
      .orderBy("pc.username")
  );
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
