#!/usr/bin/env node
// Instagram media poller, driven per profile. Runs INSIDE the elitev2 container
// (the profile "Sync from Instagram" button via triggerSync(), or a host systemd
// timer using `docker exec`).
//
// Each local profile may connect an Instagram source in profile_extras
// (instagram_handle). For a target profile this script downloads that IG
// account's new media into the posts import folder under the LOCAL handle:
//     <POSTS_ROOT>/_import/<localHandle>/
// then runs the importers so the media attaches to THAT profile:
//     import-posts.mjs   (photos -> posts, videos -> shorts/main/_import)
//     import-shorts.mjs  (the routed videos -> main shorts clips)
//
// Download via gallery-dl (handles IG photos, carousels, and videos with a
// session cookie). Per-profile archive dedups across runs; a lockfile guards
// against overlapping runs; status is written back to profile_extras.
//
// Usage:
//   node instagram-sync.mjs                      # all ig_auto_poll profiles
//   node instagram-sync.mjs <localHandle>        # one profile, mode all
//   node instagram-sync.mjs <localHandle> --mode=photos

import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "/app/data";
const DB_PATH = path.join(DATA_DIR, "elitev2.db");
const POSTS_ROOT = process.env.POSTS_ROOT || "/posts-store";
const IMPORT_DIR =
  process.env.POSTS_IMPORT_DIR || path.join(POSTS_ROOT, "_import");
const COOKIES_ROOT = process.env.IG_COOKIES_ROOT || "/instagram-store";
const COOKIES_PATH =
  process.env.IG_COOKIES_PATH || path.join(COOKIES_ROOT, "cookies.txt");
const GALLERY_DL = process.env.GALLERY_DL_BIN || "gallery-dl";
const LOCK = "/tmp/elitev2-instagram-sync.lock";
const COOLDOWN_FILE = path.join(os.tmpdir(), "elitev2-ig-cooldowns.json");
const MAX_PER_RUN = Number(process.env.IG_MAX_PER_RUN) || 30;
const MAX_PER_COOKIE_PER_RUN = Number(process.env.IG_MAX_PER_COOKIE_PER_RUN) || 0; // 0 = unlimited
const COOLDOWN_MS = (Number(process.env.IG_COOLDOWN_MINUTES) || 60) * 60 * 1000;
const SLEEP_REQUEST = process.env.IG_SLEEP_REQUEST || "3.0-8.0";
const RETRIES = Number(process.env.IG_RETRIES) || 2;
// Between-profile pause range in seconds ("min-max"), default 15–30s.
const PROFILE_SLEEP = process.env.IG_PROFILE_SLEEP_SECONDS || "15-30";
// gallery-dl needs a writable HOME for its cache; the container's nextjs user
// has none (/nonexistent). Point it at a writable dir so session handling works.
const RUN_HOME =
  process.env.HOME && fs.existsSync(process.env.HOME)
    ? process.env.HOME
    : os.tmpdir();
const RUN_ENV = { ...process.env, HOME: RUN_HOME };

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

// --- Args ------------------------------------------------------------------
let handleArg = null;
let mode = "all";
for (const a of process.argv.slice(2)) {
  if (a.startsWith("--mode=")) mode = a.slice("--mode=".length) === "photos" ? "photos" : "all";
  else if (!a.startsWith("-")) handleArg = a.trim().toLowerCase();
}

// --- Single-run lock -------------------------------------------------------
let lockFd;
try {
  lockFd = fs.openSync(LOCK, "wx");
  fs.writeSync(lockFd, String(process.pid));
} catch (err) {
  if (err.code === "EEXIST") {
    try {
      const pid = Number(fs.readFileSync(LOCK, "utf8").trim());
      process.kill(pid, 0);
      log("another sync is running; exiting");
      // The API route already flipped ig_syncing=1 for the requested handle —
      // clear it, or the UI polls a "syncing" that never ends.
      if (handleArg) {
        try {
          const tmpDb = new Database(DB_PATH);
          tmpDb
            .prepare("UPDATE profile_extras SET ig_syncing = 0 WHERE handle = ?")
            .run(handleArg);
          tmpDb.close();
        } catch {
          /* best effort */
        }
      }
      process.exit(0);
    } catch {
      fs.rmSync(LOCK, { force: true });
      lockFd = fs.openSync(LOCK, "wx");
      fs.writeSync(lockFd, String(process.pid));
    }
  } else {
    throw err;
  }
}
process.on("exit", () => {
  try {
    fs.closeSync(lockFd);
    fs.rmSync(LOCK, { force: true });
  } catch {
    /* best effort */
  }
});

// --- Helpers ---------------------------------------------------------------
function countFiles(dir) {
  try {
    return fs.readdirSync(dir).filter((n) => !n.startsWith(".")).length;
  } catch {
    return 0;
  }
}

// --- Cookie pool -----------------------------------------------------------
// Several IG accounts can be rotated: the root cookies.txt (id "default") plus
// one cookies.txt per immediate subfolder of COOKIES_ROOT (id = folder name).
// Discovery + ordering MUST match lib/instagram.ts and scripts/ig_profile.py
// (sorted by id, deduped by realpath) so sticky hashing stays stable.
function sanitizeId(name) {
  const s = String(name || "").toLowerCase().replace(/[^a-z0-9._-]/g, "");
  return s || "default";
}

function listCookiePool() {
  const out = [];
  const seen = new Set();
  const add = (id, p) => {
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
      let st;
      try {
        st = fs.statSync(d);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      const pref = path.join(d, "cookies.txt");
      if (fs.existsSync(pref)) {
        add(sanitizeId(name), pref);
      } else {
        const txts = fs.readdirSync(d).filter((f) => f.endsWith(".txt")).sort();
        if (txts.length) add(sanitizeId(name), path.join(d, txts[0]));
      }
    }
  } catch {
    /* root may not exist */
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

// djb2 — deterministic across runs/runtimes (matches ig_profile.py stable_hash).
function stableHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h;
}

// --- Cooldown state (shared with scripts/ig_profile.py) --------------------
function readCooldowns() {
  try {
    const d = JSON.parse(fs.readFileSync(COOLDOWN_FILE, "utf8"));
    return d && typeof d === "object" ? d : {};
  } catch {
    return {};
  }
}
function isCooling(id, cd, now) {
  const e = cd[id];
  return !!e && Number(e.until) > now;
}
function markCooling(id, reason) {
  try {
    const cd = readCooldowns();
    cd[id] = { until: Date.now() + COOLDOWN_MS, reason: String(reason || "").slice(0, 200) };
    const tmp = COOLDOWN_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(cd));
    fs.renameSync(tmp, COOLDOWN_FILE);
  } catch {
    /* best effort; last-writer-wins */
  }
}

// Sticky cookie for a local handle: start at hash(handle)%len, walk the ring,
// skip members that are cooling or over the per-run budget. null = none eligible.
function pickCookieForHandle(handle, pool, cd, perRunCount) {
  if (!pool.length) return null;
  const now = Date.now();
  const start = stableHash(handle) % pool.length;
  for (let i = 0; i < pool.length; i++) {
    const m = pool[(start + i) % pool.length];
    if (isCooling(m.id, cd, now)) continue;
    if (MAX_PER_COOKIE_PER_RUN > 0 && (perRunCount[m.id] || 0) >= MAX_PER_COOKIE_PER_RUN) continue;
    return m;
  }
  return null;
}

// gallery-dl rewrites the cookies.txt in place (cookies-update); the mounted
// file is read-only to the runtime uid. Work on a per-cookie writable copy so
// the rotation write-back doesn't fail and accounts never collide.
function writableCookies(srcPath, id) {
  const dest = path.join(os.tmpdir(), `elitev2-ig-cookies-${sanitizeId(id)}.txt`);
  try {
    fs.copyFileSync(srcPath, dest);
    return dest;
  } catch {
    return srcPath;
  }
}

// Parse a "min-max" (or single) seconds range into a random ms value.
function randMsFromRange(range, fallbackMin, fallbackMax) {
  const m = String(range || "").match(/^\s*([\d.]+)\s*-\s*([\d.]+)\s*$/);
  let lo = fallbackMin;
  let hi = fallbackMax;
  if (m) {
    lo = parseFloat(m[1]);
    hi = parseFloat(m[2]);
  } else {
    const one = parseFloat(range);
    if (Number.isFinite(one)) lo = hi = one;
  }
  if (!(hi >= lo)) hi = lo;
  return Math.round((lo + Math.random() * (hi - lo)) * 1000);
}

// Download an IG account's new media into the LOCAL profile's import subfolder
// via gallery-dl (photos, carousels, and videos), using the given cookie pool
// member. Returns { added, error, blocked } — blocked=true on a rate-limit/
// auth rejection (the caller cools that cookie down and retries with another).
function downloadProfile(localHandle, igUsername, cookie) {
  const dir = path.join(IMPORT_DIR, localHandle);
  fs.mkdirSync(dir, { recursive: true });
  const before = countFiles(dir);
  const cookies = cookie ? writableCookies(cookie.path, cookie.id) : null;
  const gdArchive = path.join(dir, ".gallery-dl-archive.sqlite");

  const rangeUpper = Math.min(before + MAX_PER_RUN, 500);
  const gdArgs = [
    `https://www.instagram.com/${igUsername}/`,
    "-D",
    dir,
    "--filename",
    "{shortcode|post_shortcode|id}_{num|0}.{extension}",
    "--range",
    `1-${rangeUpper}`,
    "--download-archive",
    gdArchive,
    // Space out HTTP requests (randomized) so a multi-profile run stays under
    // Instagram's rate limit instead of tripping "Please wait a few minutes".
    "--sleep-request",
    SLEEP_REQUEST,
    "--retries",
    String(RETRIES),
    // Write a <file>.json sidecar per item (caption, shortcode, date, tags) so
    // import-posts can set the post caption + hashtags and group carousels.
    "--write-metadata",
  ];
  if (mode === "photos") gdArgs.push("-o", "videos=false");
  if (cookies) gdArgs.push("--cookies", cookies);

  let lastErr = null;
  let blocked = false;
  try {
    execFileSync(GALLERY_DL, gdArgs, {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 5 * 60 * 1000,
      env: RUN_ENV,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (err) {
    const stderr = `${err.stderr || ""}\n${err.message || ""}`;
    if (/NotFoundError|could not be found|\b401\b|\b429\b|login_required|Please wait a few minutes/i.test(stderr)) {
      blocked = true;
      lastErr = "Instagram rejected the request (rate-limit / expired session).";
    } else {
      const m = stderr.match(/\[[a-z]+\]\[error\][^\n]*/i);
      lastErr = (m ? m[0] : err.message || "download failed").slice(0, 300);
    }
  }

  const after = countFiles(dir);
  const added = Math.max(0, after - before);
  return { added, error: added > 0 ? null : lastErr, blocked: added > 0 ? false : blocked };
}

// --- Main ------------------------------------------------------------------
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 15000");

// We hold the single-run lock, so any ig_syncing=1 left in the DB is a stale
// flag from a crashed/killed run — clear them all (they are re-set per handle
// below) so the UI never shows an eternal "syncing".
try {
  db.prepare("UPDATE profile_extras SET ig_syncing = 0 WHERE ig_syncing = 1").run();
} catch {
  /* best effort */
}

const targets = handleArg
  ? db
      .prepare(
        "SELECT handle, instagram_handle FROM profile_extras WHERE handle = ? AND instagram_handle IS NOT NULL AND instagram_handle <> ''"
      )
      .all(handleArg)
  : db
      .prepare(
        "SELECT handle, instagram_handle FROM profile_extras WHERE ig_auto_poll = 1 AND instagram_handle IS NOT NULL AND instagram_handle <> ''"
      )
      .all();

if (targets.length === 0) {
  log(handleArg ? `no Instagram source for handle: ${handleArg}` : "no auto-poll profiles");
  console.log(`RESULT ${JSON.stringify({ profiles: 0, added: 0 })}`);
  db.close();
  process.exit(0);
}

const setSyncing = db.prepare(
  "UPDATE profile_extras SET ig_syncing = 1 WHERE handle = ?"
);
const setResult = db.prepare(
  "UPDATE profile_extras SET ig_syncing = 0, ig_last_synced_at = datetime('now'), ig_last_sync_error = ? WHERE handle = ?"
);

// Synchronous sleep (no async refactor needed) — used to breathe between
// profiles so a whole-batch auto-poll run doesn't hammer Instagram.
function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const pool = listCookiePool();
log(`cookie pool: ${pool.length ? pool.map((m) => m.id).join(", ") : "(none)"}`);

let totalAdded = 0;
const results = [];
const perRunCount = {}; // cookie id -> profiles served this run

for (const [i, t] of targets.entries()) {
  if (i > 0) sleepMs(randMsFromRange(PROFILE_SLEEP, 15, 30)); // between-profile breather
  setSyncing.run(t.handle);

  let cookie = pool.length ? pickCookieForHandle(t.handle, pool, readCooldowns(), perRunCount) : null;
  if (pool.length && !cookie) {
    // Every account is cooling down — don't dig the hole deeper.
    log(`sync ${t.handle}: all Instagram accounts cooling down, skipping`);
    const msg = "All Instagram accounts are cooling down (rate-limited). Try later.";
    setResult.run(msg, t.handle);
    results.push({ handle: t.handle, ig: t.instagram_handle, added: 0, error: msg });
    continue;
  }

  log(`sync ${t.handle} <- instagram.com/${t.instagram_handle} (mode=${mode}) via cookie=${cookie?.id ?? "none"}`);
  let r;
  try {
    r = downloadProfile(t.handle, t.instagram_handle, cookie);
  } catch (err) {
    r = { added: 0, error: String(err.message || err).slice(0, 300), blocked: false };
  }
  if (cookie) perRunCount[cookie.id] = (perRunCount[cookie.id] || 0) + 1;

  // On a block, cool this cookie down and retry once with the next eligible one.
  if (r.blocked && cookie) {
    markCooling(cookie.id, r.error);
    const next = pickCookieForHandle(t.handle, pool, readCooldowns(), perRunCount);
    if (next && next.id !== cookie.id) {
      log(`  ${t.handle}: cookie=${cookie.id} blocked → retry via cookie=${next.id}`);
      try {
        r = downloadProfile(t.handle, t.instagram_handle, next);
      } catch (err) {
        r = { added: 0, error: String(err.message || err).slice(0, 300), blocked: false };
      }
      perRunCount[next.id] = (perRunCount[next.id] || 0) + 1;
      if (r.blocked) markCooling(next.id, r.error);
    }
  }

  setResult.run(r.error, t.handle);
  totalAdded += r.added;
  results.push({ handle: t.handle, ig: t.instagram_handle, added: r.added, error: r.error });
  log(`  ${t.handle}: +${r.added}${r.error ? ` (error: ${r.error})` : ""}`);
}

db.close();

// Ingest whatever was downloaded: photos -> posts, videos -> shorts. Best
// effort; the host import timers would pick it up anyway.
if (totalAdded > 0) {
  const node = process.execPath;
  const scriptsDir = path.dirname(new URL(import.meta.url).pathname);
  try {
    log("running import-posts.mjs");
    execFileSync(node, [path.join(scriptsDir, "import-posts.mjs")], {
      stdio: "inherit",
      timeout: 10 * 60 * 1000,
    });
  } catch (err) {
    log(`import-posts failed: ${String(err.message || err).slice(0, 200)}`);
  }
  // import-posts routes each creator's videos into main/ or 18plus/ _import per
  // the creator's is_adult flag, so run the shorts importer for BOTH channels.
  for (const channel of ["main", "18plus"]) {
    try {
      log(`running import-shorts.mjs (${channel})`);
      execFileSync(node, [path.join(scriptsDir, "import-shorts.mjs")], {
        stdio: "inherit",
        timeout: 10 * 60 * 1000,
        env: { ...process.env, IMPORT_CHANNEL: channel },
      });
    } catch (err) {
      log(`import-shorts (${channel}) failed: ${String(err.message || err).slice(0, 200)}`);
    }
  }
}

log(`sync complete: ${totalAdded} new file(s) across ${targets.length} profile(s)`);
console.log(`RESULT ${JSON.stringify({ profiles: targets.length, added: totalAdded, results })}`);
