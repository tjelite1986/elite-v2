#!/usr/bin/env node
// Shorts transcoder (phase v1b). Runs INSIDE the elitev2 container via
// `docker exec` on a host systemd timer, so it shares the container's ffmpeg,
// better-sqlite3 and /shorts-store mount.
//
// For every short whose stored file isn't already a web-optimized .web.mp4 it:
//   - remuxes (stream-copy) H.264/MP4 sources to add a faststart moov atom, or
//     fully re-encodes everything else to H.264/AAC (1080p ceiling, faststart),
//   - (re)generates a poster JPEG if one is missing,
//   - updates the DB row (storage_key, mime_type, size, status='ready', poster),
//   - deletes the original to save disk.
//
// Failures flip the row to status='failed' so the timer doesn't retry forever;
// re-uploading replaces the row. A flock-style lockfile prevents overlapping
// runs. Output goes to stdout (captured by journald).

import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "/app/data";
const DB_PATH = path.join(DATA_DIR, "elitev2.db");
const SHORTS_ROOT = process.env.SHORTS_ROOT || "/shorts-store";
// Per-user uploads live under PROFILE_ROOT/u_<user>/{shorts,shorts18}/... — their
// storage_key is self-describing (matches isUploadKey), so resolve those there
// instead of under the shared SHORTS_ROOT/<channel> creator layout. Keep this
// regex in sync with lib/shorts-storage.ts (shorts18 matched before shorts).
const PROFILE_ROOT = process.env.PROFILE_ROOT || "/profile-store";
const isUploadKey = (key) => /^u_[^/]+\/(?:shorts18|shorts)\//.test(key);
const LOCK = "/tmp/elitev2-shorts-transcode.lock";

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

// --- Single-run lock -------------------------------------------------------
let lockFd;
try {
  lockFd = fs.openSync(LOCK, "wx");
  fs.writeSync(lockFd, String(process.pid));
} catch (err) {
  if (err.code === "EEXIST") {
    // Stale lock if the holder is gone; otherwise another run is active.
    try {
      const pid = Number(fs.readFileSync(LOCK, "utf8").trim());
      process.kill(pid, 0); // throws if pid is dead
      process.exit(0); // a live run holds the lock
    } catch {
      fs.rmSync(LOCK, { force: true });
      lockFd = fs.openSync(LOCK, "wx");
      fs.writeSync(lockFd, String(process.pid));
    }
  } else {
    throw err;
  }
}
const releaseLock = () => {
  try {
    fs.closeSync(lockFd);
    fs.rmSync(LOCK, { force: true });
  } catch {
    /* best effort */
  }
};
process.on("exit", releaseLock);

// --- Helpers ---------------------------------------------------------------
function channelDir(channel) {
  return path.join(SHORTS_ROOT, channel === "18plus" ? "18plus" : "main");
}

function videoCodec(filePath) {
  try {
    const out = execFileSync(
      "ffprobe",
      [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=codec_name",
        "-of", "csv=p=0",
        filePath,
      ],
      { encoding: "utf8" }
    );
    return out.trim().toLowerCase();
  } catch {
    return "";
  }
}

function remuxCopy(src, dst) {
  execFileSync(
    "ffmpeg",
    ["-y", "-hide_banner", "-loglevel", "error", "-nostdin", "-i", src,
     "-c", "copy", "-movflags", "+faststart", dst],
    { stdio: "ignore" }
  );
}

function fullTranscode(src, dst) {
  execFileSync(
    "ffmpeg",
    ["-y", "-hide_banner", "-loglevel", "error", "-nostdin", "-i", src,
     "-c:v", "libx264", "-profile:v", "main", "-level", "4.0",
     "-preset", "veryfast", "-crf", "26",
     "-maxrate", "1800k", "-bufsize", "3600k",
     "-vf", "scale='min(1080,iw)':-2",
     "-c:a", "aac", "-b:a", "96k", "-ac", "2",
     "-movflags", "+faststart", dst],
    { stdio: "ignore" }
  );
}

function makePoster(videoPath, posterPath) {
  let pct = "0.5";
  try {
    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", videoPath],
      { encoding: "utf8" }
    );
    const dur = parseFloat(out.trim());
    if (dur > 0) pct = (dur * 0.25).toFixed(2);
  } catch {
    /* keep default seek */
  }
  // Some files yield no frame when seeking deep in (broken index / sparse
  // keyframes), so fall back to early seeks and finally the first frame.
  for (const seek of [pct, "1", "0"]) {
    try {
      execFileSync(
        "ffmpeg",
        ["-y", "-hide_banner", "-loglevel", "error", "-nostdin",
         "-ss", seek, "-i", videoPath, "-vframes", "1",
         "-vf", "scale='min(720,iw)':-2", "-q:v", "5", posterPath],
        { stdio: "ignore" }
      );
    } catch {
      /* try the next seek */
    }
    if (fs.existsSync(posterPath) && fs.statSync(posterPath).size > 0) return;
  }
}

function videoDimensions(filePath) {
  try {
    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0",
       "-show_entries", "stream=width,height", "-of", "csv=p=0", filePath],
      { encoding: "utf8" }
    );
    const [w, h] = out.trim().split(",").map((n) => parseInt(n, 10));
    return { width: Number.isFinite(w) ? w : null, height: Number.isFinite(h) ? h : null };
  } catch {
    return { width: null, height: null };
  }
}

// --- Main ------------------------------------------------------------------
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 10000"); // tolerate the app/poller writing too

const rows = db
  .prepare(
    `SELECT id, channel, storage_key, poster_key
       FROM shorts
      WHERE is_deleted = 0
        AND status != 'failed'
        AND storage_key NOT LIKE '%.web.mp4'`
  )
  .all();

let processed = 0;
let failed = 0;

for (const row of rows) {
  const dir = isUploadKey(row.storage_key) ? PROFILE_ROOT : channelDir(row.channel);
  const src = path.join(dir, row.storage_key);
  const uuid = row.storage_key.replace(/\.[^.]+$/, "");
  const dstKey = `${uuid}.web.mp4`;
  const dst = path.join(dir, dstKey);
  const tmp = `${dst}.tmp.mp4`;

  if (!fs.existsSync(src)) {
    log(`missing source for short ${row.id}: ${src} — marking failed`);
    db.prepare("UPDATE shorts SET status = 'failed' WHERE id = ?").run(row.id);
    failed++;
    continue;
  }

  log(`transcoding short ${row.id}: ${row.storage_key}`);
  try {
    fs.rmSync(tmp, { force: true });
    const ext = path.extname(row.storage_key).slice(1).toLowerCase();
    const codec = videoCodec(src);
    const canRemux = (ext === "mp4" || ext === "m4v") && codec === "h264";

    if (canRemux) {
      try {
        remuxCopy(src, tmp);
      } catch {
        log(`remux failed for short ${row.id}, falling back to full transcode`);
        fs.rmSync(tmp, { force: true });
        fullTranscode(src, tmp);
      }
    } else {
      fullTranscode(src, tmp);
    }

    if (!fs.existsSync(tmp) || fs.statSync(tmp).size === 0) {
      throw new Error("ffmpeg produced no output");
    }
    fs.renameSync(tmp, dst);

    // Poster: keep an existing one, otherwise extract from the new video.
    let posterKey = row.poster_key;
    if (!posterKey || !fs.existsSync(path.join(dir, posterKey))) {
      const pk = `${uuid}.jpg`;
      try {
        makePoster(dst, path.join(dir, pk));
        if (fs.existsSync(path.join(dir, pk))) posterKey = pk;
      } catch {
        /* poster is best-effort */
      }
    }

    const { width, height } = videoDimensions(dst);
    const size = fs.statSync(dst).size;

    db.prepare(
      `UPDATE shorts
          SET storage_key = ?, poster_key = ?, mime_type = 'video/mp4',
              width = COALESCE(?, width), height = COALESCE(?, height),
              size_bytes = ?, status = 'ready'
        WHERE id = ?`
    ).run(dstKey, posterKey, width, height, size, row.id);

    // Remove the original now that the row points at the .web.mp4.
    if (src !== dst) fs.rmSync(src, { force: true });

    log(`done short ${row.id}: ${dstKey} (${(size / 1e6).toFixed(1)} MB, original removed)`);
    processed++;
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    log(`failed short ${row.id}: ${err.message} — marking failed`);
    db.prepare("UPDATE shorts SET status = 'failed' WHERE id = ?").run(row.id);
    failed++;
  }
}

// --- Poster backfill -------------------------------------------------------
// Clips already stored as .web.mp4 (e.g. imports / legacy clips) are skipped by
// the transcode loop above, so any of them without a poster never got a
// thumbnail. Generate one from the existing video, no re-encode.
let postersMade = 0;
const noPoster = db
  .prepare(
    `SELECT id, channel, storage_key, poster_key
       FROM shorts
      WHERE is_deleted = 0
        AND status = 'ready'
        AND (poster_key IS NULL OR poster_key = '')`
  )
  .all();

for (const row of noPoster) {
  const dir = isUploadKey(row.storage_key) ? PROFILE_ROOT : channelDir(row.channel);
  const src = path.join(dir, row.storage_key);
  if (!fs.existsSync(src)) continue;
  const base = row.storage_key.replace(/\.[^.]+$/, "");
  const pk = `${base}.jpg`;
  try {
    makePoster(src, path.join(dir, pk));
    if (fs.existsSync(path.join(dir, pk))) {
      db.prepare("UPDATE shorts SET poster_key = ? WHERE id = ?").run(pk, row.id);
      postersMade++;
    }
  } catch {
    /* poster is best-effort */
  }
}

if (processed > 0 || failed > 0 || postersMade > 0) {
  log(
    `run complete: ${processed} processed, ${failed} failed, ${postersMade} posters backfilled`
  );
}
db.close();
