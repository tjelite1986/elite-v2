#!/usr/bin/env node
// TikTok media poller, driven per profile. Runs INSIDE the elitev2 container
// (the profile "Sync from TikTok" button via triggerSync(), or a host systemd
// timer / in-app job using `docker exec`).
//
// Each local profile may connect a TikTok source in profile_extras
// (tiktok_handle). For a target profile this script downloads that TikTok
// account's new media into the posts import folder under the LOCAL handle:
//     <POSTS_ROOT>/_import/<localHandle>/
// then runs the importers so the media attaches to THAT profile:
//     import-posts.mjs   (photos -> posts, videos -> shorts/main/_import)
//     import-shorts.mjs  (the routed videos -> main shorts clips)
//
// Download via gallery-dl, falling back to yt-dlp. Unlike Instagram, NO cookie
// is required: TikTok public profiles download anonymously. A cookies.txt is
// used ONLY when present (`--cookies <file>`); its absence never blocks a sync.
// Per-profile archive dedups across runs; a lockfile guards overlapping runs;
// status is written back to profile_extras (tt_*).
//
// Usage:
//   node tiktok-sync.mjs                      # all tt_auto_poll profiles
//   node tiktok-sync.mjs <localHandle>        # one profile, mode all
//   node tiktok-sync.mjs <localHandle> --mode=photos

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
// Optional Netscape cookies.txt; used only when it exists (cookie-optional).
const COOKIES_PATH =
  process.env.TIKTOK_COOKIES_PATH ||
  path.join(process.env.TIKTOK_COOKIES_ROOT || "/tiktok-store", "cookies.txt");
const GALLERY_DL = process.env.GALLERY_DL_BIN || "gallery-dl";
const YT_DLP = process.env.YT_DLP_BIN || "yt-dlp";
const LOCK = "/tmp/elitev2-tiktok-sync.lock";
const MAX_PER_RUN = Number(process.env.TT_MAX_PER_RUN) || 30;
const RETRIES = Number(process.env.TT_RETRIES) || 2;
// Between-profile pause range in seconds ("min-max"), default 10-20s.
const PROFILE_SLEEP = process.env.TT_PROFILE_SLEEP_SECONDS || "10-20";
// gallery-dl/yt-dlp need a writable HOME for their cache; the container's nextjs
// user has none (/nonexistent). Point it at a writable dir.
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

// Path to the optional cookie file if present, else null. Cookie-optional: a
// missing file means a public, anonymous download (NOT an error).
function cookieFile() {
  try {
    if (fs.statSync(COOKIES_PATH).isFile()) return COOKIES_PATH;
  } catch {
    /* no cookie -> public download */
  }
  return null;
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

// Download a TikTok account's new media into the LOCAL profile's import
// subfolder. Tries gallery-dl first; if it adds nothing / fails, falls back to
// yt-dlp. Both run WITHOUT cookies unless a cookies.txt is present. Returns
// { added, error }.
function downloadProfile(localHandle, ttUsername) {
  const dir = path.join(IMPORT_DIR, localHandle);
  fs.mkdirSync(dir, { recursive: true });
  const before = countFiles(dir);
  const cookie = cookieFile();
  const url = `https://www.tiktok.com/@${ttUsername}`;

  // --- gallery-dl ---------------------------------------------------------
  const gdArchive = path.join(dir, ".gallery-dl-archive.sqlite");
  const rangeUpper = Math.min(before + MAX_PER_RUN, 500);
  const gdArgs = [
    url,
    "-D",
    dir,
    "--range",
    `1-${rangeUpper}`,
    "--download-archive",
    gdArchive,
    "--retries",
    String(RETRIES),
    // Write a <file>.json sidecar per item so import-posts can set captions.
    "--write-metadata",
  ];
  if (mode === "photos") gdArgs.push("-o", "videos=false");
  if (cookie) gdArgs.push("--cookies", cookie);

  let lastErr = null;
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
    const m = stderr.match(/\[[a-z]+\]\[error\][^\n]*/i);
    lastErr = (m ? m[0] : err.message || "gallery-dl failed").slice(0, 300);
  }

  let after = countFiles(dir);
  let added = Math.max(0, after - before);

  // --- yt-dlp fallback ----------------------------------------------------
  // gallery-dl's TikTok support is fragile; when it produced nothing, retry
  // with yt-dlp (videos only — photo slideshows stay gallery-dl's domain).
  if (added === 0 && mode !== "photos") {
    const ytArchive = path.join(dir, ".yt-dlp-archive.txt");
    const ytArgs = [
      url,
      "-o",
      path.join(dir, "%(id)s.%(ext)s"),
      "--download-archive",
      ytArchive,
      "--no-warnings",
      "--ignore-errors",
      "--max-downloads",
      String(MAX_PER_RUN),
    ];
    if (cookie) ytArgs.push("--cookies", cookie);
    try {
      execFileSync(YT_DLP, ytArgs, {
        stdio: ["ignore", "ignore", "pipe"],
        timeout: 5 * 60 * 1000,
        env: RUN_ENV,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      });
    } catch (err) {
      // yt-dlp exits non-zero on --max-downloads; only record if nothing landed.
      const stderr = `${err.stderr || ""}\n${err.message || ""}`;
      if (!/max-downloads/i.test(stderr)) {
        const m = stderr.match(/ERROR:[^\n]*/i);
        if (m) lastErr = m[0].slice(0, 300);
      }
    }
    after = countFiles(dir);
    added = Math.max(0, after - before);
  }

  return { added, error: added > 0 ? null : lastErr };
}

// --- Main ------------------------------------------------------------------
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 15000");

const targets = handleArg
  ? db
      .prepare(
        "SELECT handle, tiktok_handle FROM profile_extras WHERE handle = ? AND tiktok_handle IS NOT NULL AND tiktok_handle <> ''"
      )
      .all(handleArg)
  : db
      .prepare(
        "SELECT handle, tiktok_handle FROM profile_extras WHERE tt_auto_poll = 1 AND tiktok_handle IS NOT NULL AND tiktok_handle <> ''"
      )
      .all();

if (targets.length === 0) {
  log(handleArg ? `no TikTok source for handle: ${handleArg}` : "no auto-poll profiles");
  console.log(`RESULT ${JSON.stringify({ profiles: 0, added: 0 })}`);
  db.close();
  process.exit(0);
}

const setSyncing = db.prepare(
  "UPDATE profile_extras SET tt_syncing = 1 WHERE handle = ?"
);
const setResult = db.prepare(
  "UPDATE profile_extras SET tt_syncing = 0, tt_last_synced_at = datetime('now'), tt_last_sync_error = ? WHERE handle = ?"
);

// Synchronous sleep (no async refactor needed) — breathe between profiles.
function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

log(`cookies: ${cookieFile() ? "present" : "none (public download)"}`);

let totalAdded = 0;
const results = [];

for (const [i, t] of targets.entries()) {
  if (i > 0) sleepMs(randMsFromRange(PROFILE_SLEEP, 10, 20)); // between-profile breather
  setSyncing.run(t.handle);

  log(`sync ${t.handle} <- tiktok.com/@${t.tiktok_handle} (mode=${mode})`);
  let r;
  try {
    r = downloadProfile(t.handle, t.tiktok_handle);
  } catch (err) {
    r = { added: 0, error: String(err.message || err).slice(0, 300) };
  }

  setResult.run(r.error, t.handle);
  totalAdded += r.added;
  results.push({ handle: t.handle, tiktok: t.tiktok_handle, added: r.added, error: r.error });
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
