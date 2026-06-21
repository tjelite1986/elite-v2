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
const COOKIES_PATH =
  process.env.IG_COOKIES_PATH || "/instagram-store/.cookies.txt";
const GALLERY_DL = process.env.GALLERY_DL_BIN || "gallery-dl";
const LOCK = "/tmp/elitev2-instagram-sync.lock";
const MAX_PER_RUN = 30;
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
function hasCookies() {
  try {
    return fs.statSync(COOKIES_PATH).size > 0;
  } catch {
    return false;
  }
}

function countFiles(dir) {
  try {
    return fs.readdirSync(dir).filter((n) => !n.startsWith(".")).length;
  } catch {
    return 0;
  }
}

// gallery-dl rewrites the cookies.txt in place (cookies-update); the mounted
// file is owned by another uid and read-only to us. Work on a writable copy so
// the rotation write-back doesn't fail with EACCES.
function writableCookies() {
  if (!hasCookies()) return null;
  const dest = path.join(os.tmpdir(), "elitev2-ig-cookies.txt");
  try {
    fs.copyFileSync(COOKIES_PATH, dest);
    return dest;
  } catch {
    return COOKIES_PATH;
  }
}

// Download an IG account's new media into the LOCAL profile's import subfolder
// via gallery-dl (photos, carousels, and videos). Returns { added, error }.
function downloadProfile(localHandle, igUsername) {
  const dir = path.join(IMPORT_DIR, localHandle);
  fs.mkdirSync(dir, { recursive: true });
  const before = countFiles(dir);
  const cookies = writableCookies();
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
    // Write a <file>.json sidecar per item (caption, shortcode, date, tags) so
    // import-posts can set the post caption + hashtags and group carousels.
    "--write-metadata",
  ];
  if (mode === "photos") gdArgs.push("-o", "videos=false");
  if (cookies) gdArgs.push("--cookies", cookies);

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
    if (/NotFoundError|could not be found|\b401\b|login_required/i.test(stderr)) {
      lastErr = "Instagram rejected the request — session cookies expired? Re-export cookies.txt.";
    } else {
      const m = stderr.match(/\[[a-z]+\]\[error\][^\n]*/i);
      lastErr = (m ? m[0] : err.message || "download failed").slice(0, 300);
    }
  }

  const after = countFiles(dir);
  const added = Math.max(0, after - before);
  return { added, error: added > 0 ? null : lastErr };
}

// --- Main ------------------------------------------------------------------
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 15000");

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

let totalAdded = 0;
const results = [];

for (const t of targets) {
  setSyncing.run(t.handle);
  log(`sync ${t.handle} <- instagram.com/${t.instagram_handle} (mode=${mode})`);
  let r;
  try {
    r = downloadProfile(t.handle, t.instagram_handle);
  } catch (err) {
    r = { added: 0, error: String(err.message || err).slice(0, 300) };
  }
  setResult.run(r.error, t.handle);
  totalAdded += r.added;
  results.push({ handle: t.handle, ig: t.instagram_handle, ...r });
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
  try {
    log("running import-shorts.mjs (main)");
    execFileSync(node, [path.join(scriptsDir, "import-shorts.mjs")], {
      stdio: "inherit",
      timeout: 10 * 60 * 1000,
      env: { ...process.env, IMPORT_CHANNEL: "main" },
    });
  } catch (err) {
    log(`import-shorts failed: ${String(err.message || err).slice(0, 200)}`);
  }
}

log(`sync complete: ${totalAdded} new file(s) across ${targets.length} profile(s)`);
console.log(`RESULT ${JSON.stringify({ profiles: targets.length, added: totalAdded, results })}`);
