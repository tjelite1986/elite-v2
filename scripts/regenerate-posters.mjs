#!/usr/bin/env node
// Poster repair. Runs INSIDE the elitev2 container via `docker exec`, so it
// shares the container's ffmpeg, better-sqlite3, sharp and /shorts-store mount.
//
// A poster is grabbed a fixed distance into the clip, so a clip that opens on a
// black frame (fade-in, letterbox, dark intro) ends up with a poster that reads
// as a broken thumbnail in the grid even though the file is perfectly valid.
// This script finds those, samples several timestamps across the video, and
// keeps the most detailed frame (highest pixel standard deviation).
//
// The new poster gets a fresh UUID key so poster_v changes and the cache-first
// service worker fetches it instead of serving the old cover forever.
//
// Usage (from the host):
//   docker exec elitev2 node /app/scripts/regenerate-posters.mjs --dry-run
//   docker exec elitev2 node /app/scripts/regenerate-posters.mjs
//   docker exec elitev2 node /app/scripts/regenerate-posters.mjs --ids=1419,3843
//
// Flags:
//   --dry-run          report what would change, write nothing
//   --threshold=<n>    a poster below this stddev counts as broken (default 25)
//   --ids=<a,b,c>      repair exactly these short ids, whatever their score
//   --limit=<n>        stop after n repairs
//   --min-gain=<n>     require the new frame to beat the old one by this much
//                      stddev before replacing it (default 5)

import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const DATA_DIR = process.env.DATA_DIR || "/app/data";
const DB_PATH = path.join(DATA_DIR, "elitev2.db");
const SHORTS_ROOT = process.env.SHORTS_ROOT || "/shorts-store";
// Keep this regex in sync with lib/shorts-storage.ts (shorts18 before shorts).
const PROFILE_ROOT = process.env.PROFILE_ROOT || "/profile-store";
const isUploadKey = (key) => /^u_[^/]+\/(?:shorts18|shorts)\//.test(key);
const POSTER_MAX = 720;

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const DRY_RUN = process.argv.includes("--dry-run");
const THRESHOLD = Number(arg("threshold", 25));
const MIN_GAIN = Number(arg("min-gain", 5));
const LIMIT = Number(arg("limit", 0)) || Infinity;
const ONLY_IDS = (arg("ids", "") || "")
  .split(",")
  .map((s) => parseInt(s.trim(), 10))
  .filter(Number.isFinite);

const channelDir = (channel) =>
  path.join(SHORTS_ROOT, channel === "18plus" ? "18plus" : "main");
const pathFor = (channel, key) =>
  isUploadKey(key) ? path.join(PROFILE_ROOT, key) : path.join(channelDir(channel), key);

// Mean per-channel standard deviation: how much detail an image carries. A
// black or otherwise flat frame lands near 0; a real frame is well above 25.
async function detailScore(file) {
  const stats = await sharp(file).stats();
  return stats.channels.reduce((sum, c) => sum + c.stdev, 0) / stats.channels.length;
}

function videoDuration(filePath) {
  try {
    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath],
      { encoding: "utf8" }
    );
    const dur = parseFloat(out.trim());
    return Number.isFinite(dur) && dur > 0 ? dur : null;
  } catch {
    return null;
  }
}

// Timestamps to try, as a fraction of the duration. Deliberately skips the very
// start and the very end — both are where fades live.
const SAMPLE_FRACTIONS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];

function grabFrame(videoPath, seek, outPath) {
  try {
    execFileSync(
      "ffmpeg",
      ["-y", "-hide_banner", "-loglevel", "error", "-nostdin",
       "-ss", seek.toFixed(2), "-i", videoPath, "-frames:v", "1",
       "-vf", `scale='min(${POSTER_MAX},iw)':-2`, "-q:v", "3", outPath],
      { stdio: "ignore" }
    );
  } catch {
    /* checked by the caller via file size */
  }
  return fs.existsSync(outPath) && fs.statSync(outPath).size > 0;
}

// Pick the most detailed frame in the clip. Returns { file, score } or null;
// the caller owns the returned temp file and must unlink it.
async function bestFrame(videoPath, workDir) {
  const duration = videoDuration(videoPath);
  const seeks = duration
    ? SAMPLE_FRACTIONS.map((f) => duration * f)
    : [1, 2, 3, 5, 8];
  let best = null;
  for (const [i, seek] of seeks.entries()) {
    const candidate = path.join(workDir, `frame-${i}.jpg`);
    if (!grabFrame(videoPath, seek, candidate)) continue;
    let score;
    try {
      score = await detailScore(candidate);
    } catch {
      fs.rmSync(candidate, { force: true });
      continue;
    }
    if (!best || score > best.score) {
      if (best) fs.rmSync(best.file, { force: true });
      best = { file: candidate, score, seek };
    } else {
      fs.rmSync(candidate, { force: true });
    }
  }
  return best;
}

// --- Main ------------------------------------------------------------------
const db = new Database(DB_PATH);
// busy_timeout FIRST: the WAL switch itself takes a write lock, and a process
// that loses that race fails instantly with SQLITE_BUSY when no timeout is set.
db.pragma("busy_timeout = 10000");
db.pragma("journal_mode = WAL");

const rows = db
  .prepare(
    `SELECT id, channel, caption, storage_key, poster_key
       FROM shorts
      WHERE is_deleted = 0
        AND status = 'ready'
      ORDER BY id`
  )
  .all()
  .filter((r) => (ONLY_IDS.length ? ONLY_IDS.includes(r.id) : true));

log(
  `scanning ${rows.length} clip(s); threshold=${THRESHOLD} min-gain=${MIN_GAIN}` +
    (DRY_RUN ? " (dry run)" : "")
);

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "poster-repair-"));
let broken = 0;
let repaired = 0;
let skipped = 0;
let failed = 0;

try {
  for (const row of rows) {
    if (repaired >= LIMIT) break;

    const videoPath = pathFor(row.channel, row.storage_key);
    // A poster is only worth judging against the clip it came from.
    if (!fs.existsSync(videoPath) || fs.statSync(videoPath).size === 0) continue;

    // Current score. A missing or unreadable poster scores -1, i.e. always
    // worth replacing.
    let currentScore = -1;
    if (row.poster_key) {
      const posterPath = pathFor(row.channel, row.poster_key);
      try {
        currentScore = await detailScore(posterPath);
      } catch {
        currentScore = -1;
      }
    }
    // An explicit --ids run repairs regardless of how the poster scores.
    if (!ONLY_IDS.length && currentScore >= THRESHOLD) continue;
    broken++;

    const best = await bestFrame(videoPath, workDir);
    if (!best) {
      failed++;
      log(`id=${row.id} FAILED: no frame could be decoded from ${row.storage_key}`);
      continue;
    }

    const gain = best.score - currentScore;
    const label =
      `id=${row.id} cur=${currentScore.toFixed(1)} ` +
      `best=${best.score.toFixed(1)} @${best.seek.toFixed(1)}s`;

    if (gain < MIN_GAIN) {
      // The clip really is this dark all the way through — replacing the poster
      // would churn the cache for nothing.
      skipped++;
      log(`${label} — skipped, no better frame in the clip`);
      fs.rmSync(best.file, { force: true });
      continue;
    }

    if (DRY_RUN) {
      repaired++;
      log(`${label} — would replace`);
      fs.rmSync(best.file, { force: true });
      continue;
    }

    try {
      const dir = path.dirname(row.storage_key); // the poster lives beside the video
      const newKey = dir === "." ? `${randomUUID()}.jpg` : `${dir}/${randomUUID()}.jpg`;
      const newPath = pathFor(row.channel, newKey);
      fs.mkdirSync(path.dirname(newPath), { recursive: true });
      await sharp(best.file)
        .resize(POSTER_MAX, POSTER_MAX, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toFile(newPath);

      // Update the row before unlinking the old file: a row pointing at a
      // deleted poster is the one failure mode worth avoiding here.
      db.prepare("UPDATE shorts SET poster_key = ? WHERE id = ?").run(newKey, row.id);

      if (row.poster_key && row.poster_key !== newKey) {
        const oldPath = pathFor(row.channel, row.poster_key);
        try {
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        } catch {
          /* best effort */
        }
      }
      repaired++;
      log(`${label} — replaced -> ${newKey}`);
    } catch (err) {
      failed++;
      log(`id=${row.id} FAILED: ${err.message || err}`);
    } finally {
      fs.rmSync(best.file, { force: true });
    }
  }
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
  db.close();
}

log(
  `done: ${broken} below threshold, ${repaired} ${DRY_RUN ? "would be " : ""}replaced, ` +
    `${skipped} left alone (dark clip), ${failed} failed`
);
