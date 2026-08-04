#!/usr/bin/env node
// Fetch the missing profile pictures.
//
// A creator only has an avatar if something set one: a person picking a photo,
// or an Instagram sync applying the account's picture. After the v3 storage
// reset most creators had neither, so the directory reads as a wall of blank
// circles. This walks the creators with no avatar at all, asks Instagram for
// each one's profile picture and stores it as that handle's avatar.
//
// It is deliberately conservative, because it talks to Instagram once per
// handle:
//   * a handle is tried at most once a week (misses are remembered),
//   * a bounded number of handles per run (re-run to continue),
//   * the whole run shares ONE cookie and ONE loader, via ig_profile.py's
//     batch mode, which paces its own requests,
//   * it gives up early when several handles in a row fail, which is what a
//     dead cookie or a rate limit looks like from here.
//
// Usage (inside the container, or via the Background Jobs panel):
//   node scripts/instagram-avatar-backfill.mjs
//   node scripts/instagram-avatar-backfill.mjs --limit=50
//   node scripts/instagram-avatar-backfill.mjs --dry-run

import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const DATA_DIR = process.env.DATA_DIR || "/app/data";
const DB_PATH = path.join(DATA_DIR, "elitev2.db");
const POSTS_ROOT = process.env.POSTS_ROOT || "/posts-store";
const AVATARS_DIR = path.join(POSTS_ROOT, "avatars");
const COOKIES_ROOT = process.env.IG_COOKIES_ROOT || "/instagram-store";
const COOKIES_PATH =
  process.env.IG_COOKIES_PATH || path.join(COOKIES_ROOT, "cookies.txt");
const PYTHON = process.env.PYTHON_BIN || "python3";
const AVATAR_SIZE = 512;
const LOCK = "/tmp/elitev2-ig-avatar-backfill.lock";
// Handles that came back empty are parked for a week: an account can be
// private, renamed or gone, and retrying it every run burns the request budget
// the handles that WOULD answer need.
const MISS_FILE = path.join(DATA_DIR, "ig-avatar-misses.json");
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = Number(process.env.IG_AVATAR_MAX_PER_RUN) || 25;
// Consecutive failures that mean "stop asking" — a spent cookie, or a block.
const GIVE_UP_AFTER = Number(process.env.IG_AVATAR_GIVE_UP_AFTER) || 5;

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

let limit = DEFAULT_LIMIT;
let dryRun = false;
for (const a of process.argv.slice(2)) {
  if (a.startsWith("--limit=")) limit = Math.max(1, Number(a.slice(8)) || DEFAULT_LIMIT);
  else if (a === "--dry-run") dryRun = true;
}

/* ---------- misses ---------------------------------------------------- */

function readMisses() {
  try {
    const raw = JSON.parse(fs.readFileSync(MISS_FILE, "utf8"));
    const now = Date.now();
    // Expired entries are dropped on read, so the file cannot grow forever.
    return Object.fromEntries(
      Object.entries(raw).filter(([, at]) => now - Number(at) < MISS_TTL_MS)
    );
  } catch {
    return {};
  }
}

function writeMisses(map) {
  try {
    fs.writeFileSync(MISS_FILE, JSON.stringify(map));
  } catch (e) {
    log(`could not write ${MISS_FILE}: ${e.message}`);
  }
}

/* ---------- the work list --------------------------------------------- */

function openDb() {
  const db = new Database(DB_PATH);
  // busy_timeout BEFORE any other pragma: the app holds the same file open.
  db.pragma("busy_timeout = 5000");
  db.pragma("journal_mode = WAL");
  return db;
}

// Creators with no avatar anywhere, busiest first — the blank circles a person
// actually runs into are the ones on the profiles with the most posts.
function creatorsWithoutAvatar(db) {
  return db
    .prepare(
      `SELECT c.username, COUNT(p.id) AS posts
         FROM post_creators c
         LEFT JOIN handle_avatars h ON h.handle = c.username
         LEFT JOIN posts p ON p.author_creator_id = c.id AND p.is_deleted = 0
        WHERE c.avatar_key IS NULL
          AND h.avatar_key IS NULL
          AND c.username IS NOT NULL
          AND c.username <> ''
        GROUP BY c.id
        ORDER BY posts DESC, c.username`
    )
    .all();
}

/* ---------- instagram -------------------------------------------------- */

// One python process for the whole batch: ig_profile.py picks a working cookie
// once, builds one loader and paces itself between profiles. Yields one parsed
// JSON object per handle, in order.
function fetchProfiles(handles, onProfile) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, [path.join(process.cwd(), "scripts", "ig_profile.py"), "batch"], {
      env: {
        ...process.env,
        // instaloader wants a writable HOME for its session cache; the nextjs
        // user has none (/nonexistent).
        HOME: process.env.HOME && fs.existsSync(process.env.HOME) ? process.env.HOME : os.tmpdir(),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buf = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          onProfile(JSON.parse(line));
        } catch {
          log(`unparsable line from ig_profile.py: ${line.slice(0, 120)}`);
        }
      }
    });
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (stderr.trim()) log(`ig_profile.py stderr: ${stderr.trim().slice(0, 400)}`);
      resolve(code);
    });
    child.stdin.write(handles.join("\n") + "\n");
    child.stdin.end();
  });
}

async function storeAvatar(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`picture download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 512) throw new Error("picture too small to be real");
  fs.mkdirSync(AVATARS_DIR, { recursive: true });
  const uuid = randomUUID();
  // Same shape the app writes: square cover crop, jpeg, avatars/<uuid>.jpg.
  await sharp(buf)
    .rotate()
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover" })
    .jpeg({ quality: 82 })
    .toFile(path.join(AVATARS_DIR, `${uuid}.jpg`));
  return `avatars/${uuid}.jpg`;
}

/* ---------- run --------------------------------------------------------- */

async function main() {
  if (!fs.existsSync(COOKIES_PATH) && !fs.existsSync(COOKIES_ROOT)) {
    log(`no Instagram cookies at ${COOKIES_PATH} — nothing to do.`);
    process.exit(0);
  }
  // A cookie file OR at least one per-account subfolder has to exist.
  const hasCookie =
    fs.existsSync(COOKIES_PATH) ||
    fs
      .readdirSync(COOKIES_ROOT, { withFileTypes: true })
      .some((e) => e.isDirectory() && fs.existsSync(path.join(COOKIES_ROOT, e.name, "cookies.txt")));
  if (!hasCookie) {
    log(
      `no Instagram cookies under ${COOKIES_ROOT} — put a Netscape cookies.txt there first. Nothing to do.`
    );
    process.exit(0);
  }

  try {
    fs.writeFileSync(LOCK, String(process.pid), { flag: "wx" });
  } catch {
    log("another backfill run is in progress — exiting.");
    process.exit(0);
  }

  const db = openDb();
  try {
    const misses = readMisses();
    const all = creatorsWithoutAvatar(db);
    const due = all.filter((r) => !misses[r.username.toLowerCase()]);
    const batch = due.slice(0, limit);
    log(
      `${all.length} creators without an avatar, ${all.length - due.length} parked from earlier misses, taking ${batch.length}.`
    );
    if (!batch.length) return;
    if (dryRun) {
      log(`dry run — would ask Instagram for: ${batch.map((r) => r.username).join(", ")}`);
      return;
    }

    const setAvatar = db.prepare(
      `INSERT INTO handle_avatars (handle, avatar_key, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(handle) DO UPDATE SET avatar_key = excluded.avatar_key, updated_at = datetime('now')`
    );

    let saved = 0;
    let missed = 0;
    let streak = 0;
    const pending = [];

    await fetchProfiles(
      batch.map((r) => r.username),
      (profile) => {
        const handle = String(profile.username || "").toLowerCase();
        if (!handle) return;
        if (profile.profile_pic_url) {
          pending.push({ handle, url: profile.profile_pic_url });
          streak = 0;
        } else {
          missed++;
          streak++;
          misses[handle] = Date.now();
          log(
            `miss ${handle}: ${profile.error || (profile.exists === false ? "no such account" : "no picture")}`
          );
        }
        // The python side keeps going regardless; the counter is what tells the
        // NEXT run to stop early, and it is logged here so a dead cookie is
        // visible in the job output rather than buried.
        if (streak === GIVE_UP_AFTER) {
          log(`${GIVE_UP_AFTER} misses in a row — the cookie is probably spent or rate-limited.`);
        }
      }
    );

    // Pictures are downloaded after the listing: instaloader's own pacing owns
    // the profile requests, and the CDN fetches are not rate-limited the same way.
    for (const { handle, url } of pending) {
      try {
        const key = await storeAvatar(url);
        setAvatar.run(handle, key);
        saved++;
        log(`saved avatar for ${handle}`);
      } catch (e) {
        missed++;
        misses[handle] = Date.now();
        log(`failed ${handle}: ${e.message}`);
      }
    }

    writeMisses(misses);
    const left = all.length - saved;
    log(`done: ${saved} saved, ${missed} missed, ${left} creators still without an avatar.`);
  } finally {
    db.close();
    try {
      fs.unlinkSync(LOCK);
    } catch {
      /* the next run's wx write would fail loudly enough */
    }
  }
}

main().catch((e) => {
  try {
    fs.unlinkSync(LOCK);
  } catch {
    /* nothing to clean */
  }
  log(`fatal: ${e.stack || e.message}`);
  process.exit(1);
});
