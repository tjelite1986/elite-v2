#!/usr/bin/env node
// Import-folder sorter for the posts module. Runs INSIDE the elitev2 container
// (admin "Import now" button or a host systemd timer via docker exec).
//
// Two ways to drop into  <POSTS_ROOT>/_import/ :
//   1. Top-level files whose name encodes the creator:
//        <creator>_-_<title>.jpg          (the shorts convention)
//        <creator>-YYYYMMDD-NNNN.jpg       (the instagram-library convention)
//        <creator>_<instagram-media-id>.jpg
//   2. A subfolder named after the creator — e.g. _import/emarusova/ — whose
//      images go to that creator regardless of their filenames (one level deep).
// For each image the script resolves the creator, finds-or-creates a
// post_creators row, transcodes a display JPG + square thumbnail under
// <creator-slug>/, and deletes the original drop. Each creator's images are then
// grouped by date in the filename into carousel posts (undated => one per post).
//
// Output: human log lines + a final `RESULT {json}` line the API route parses.

import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";

const DATA_DIR = process.env.DATA_DIR || "/app/data";
const DB_PATH = path.join(DATA_DIR, "elitev2.db");
const POSTS_ROOT = process.env.POSTS_ROOT || "/posts-store";
const IMPORT_DIR = process.env.POSTS_IMPORT_DIR || path.join(POSTS_ROOT, "_import");
// Videos in a drop don't belong in the photo feed — route them to the shorts
// import folder (named for the creator) so the shorts importer makes a clip
// under the same handle. The unified /people profile merges the two. The CHANNEL
// follows the creator's is_adult flag (an adult creator's videos go to 18+, not
// the SFW main feed).
const SHORTS_ROOT = process.env.SHORTS_ROOT || "/shorts-store";
const shortsVideoDrop = (channel) =>
  path.join(SHORTS_ROOT, channel === "18plus" ? "18plus" : "main", "_import");

const IMG_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm", ".m4v"]);
const DISPLAY_MAX = 1440;
const THUMB_SIZE = 600;

const log = (m) => console.log(`[import-posts] ${m}`);
const result = (obj) => console.log(`RESULT ${JSON.stringify(obj)}`);

// --- Single-run lock (same pattern as tiktok-sync.mjs) ----------------------
// The API route and the scheduled job can both trigger this script; without a
// lock two overlapping runs list the same drop files before either deletes
// them and every image imports twice.
const LOCK = "/tmp/elitev2-import-posts.lock";
let lockFd;
try {
  lockFd = fs.openSync(LOCK, "wx");
  fs.writeSync(lockFd, String(process.pid));
} catch (err) {
  if (err.code === "EEXIST") {
    try {
      const pid = Number(fs.readFileSync(LOCK, "utf8").trim());
      process.kill(pid, 0);
      log("another import is running; exiting");
      result({ imported: 0, creatorsNew: 0, videosRouted: 0, deduped: 0, skipped: 0, alreadyRunning: true });
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

// Mirror authorSlug() in lib/posts-storage.ts so a creator maps to one folder.
function slug(name) {
  const s = (name || "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 64);
  return s || "unknown";
}

// Username for the creator (handle), matching the user-profile namespace rules.
function creatorUsername(name) {
  const s = (name || "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, "")
    .replace(/^[._]+|[._]+$/g, "")
    .slice(0, 30);
  return s || "unknown";
}

// Bracket grammar shared with the per-user importer (lib/import-naming.ts):
//   <title> [h_<tag>]... [f_<creator>]
// [f_] names the creator and takes precedence over the legacy conventions below.
function bracketCreator(stem) {
  const m = stem.match(/\[f_([^\]]+)\]/);
  return m && m[1].trim() ? m[1].trim() : null;
}

// Caption derived from a bracketed filename: the title (text before the first
// "[") plus any [h_] hashtags as #tags. Null when the name carries no brackets.
function captionFromStem(stem) {
  const fb = stem.indexOf("[");
  if (fb === -1) return null;
  const title = stem.slice(0, fb).replace(/_/g, " ").trim();
  const tags = [];
  const re = /\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(stem)) !== null) {
    const tok = m[1].trim();
    if (tok.startsWith("h_")) tags.push(`#${tok.slice(2)}`);
  }
  return [title, tags.join(" ")].filter(Boolean).join(" ").trim() || null;
}

function parseCreator(stem) {
  const f = bracketCreator(stem);
  if (f) return f;
  // <creator>_-_<title> / <creator> - <title> (the shorts naming convention) —
  // checked first so an explicit handle always wins over the date/id heuristics.
  let m = stem.match(/^(.+?)(?:_-_|\s-\s)/);
  if (m && m[1].trim()) return m[1];
  m = stem.match(/^(.+)-\d{8}-\d+/); // <creator>-YYYYMMDD-NNNN
  if (m) return m[1];
  m = stem.match(/^(.+)-\d{2}-\d{2}-\d{4}-\d+/); // <creator>-DD-MM-YYYY-NNNN
  if (m) return m[1];
  m = stem.match(/^(.+)_\d{16,}/); // <creator>_<instagram media id>
  if (m) return m[1];
  return "imported";
}

function heicToJpeg(srcPath) {
  const tmpOut = path.join(os.tmpdir(), `${randomUUID()}.jpg`);
  execFileSync("heif-convert", ["-q", "92", srcPath, tmpOut], { stdio: "ignore" });
  const buf = fs.readFileSync(tmpOut);
  try {
    fs.unlinkSync(tmpOut);
  } catch {
    /* best effort */
  }
  return buf;
}

// True only for a real HEIF container (ISO-BMFF `ftyp` box with a HEIF brand).
// Files that merely carry a .heic/.heif extension but hold JPEG/PNG/etc. bytes
// (common with mislabeled downloads) return false so we read them directly and
// let sharp decode them, instead of feeding heif-convert garbage it rejects.
function isHeif(srcPath) {
  let fd;
  try {
    fd = fs.openSync(srcPath, "r");
    const buf = Buffer.alloc(12);
    fs.readSync(fd, buf, 0, 12, 0);
    if (buf.toString("latin1", 4, 8) !== "ftyp") return false;
    const brand = buf.toString("latin1", 8, 12);
    return ["heic", "heix", "hevc", "heim", "heis", "hevm", "hevs", "mif1", "msf1", "heif"]
      .includes(brand);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* best effort */ }
    }
  }
}

if (!fs.existsSync(IMPORT_DIR)) {
  fs.mkdirSync(IMPORT_DIR, { recursive: true });
  log(`created import dir: ${IMPORT_DIR}`);
  result({ imported: 0, creatorsNew: 0, skipped: 0 });
  process.exit(0);
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 15000");

const findCreator = db.prepare("SELECT id FROM post_creators WHERE username = ?");
const findCreatorAdult = db.prepare(
  "SELECT is_adult FROM post_creators WHERE username = ?"
);
// A creator's videos go to the 18+ shorts channel when the creator is flagged
// adult; otherwise the SFW main channel. Unknown creator (video-only drop, no
// post_creator row yet) defaults to main — no regression on the old behaviour.
function creatorChannel(username) {
  const row = findCreatorAdult.get(username);
  return row && row.is_adult ? "18plus" : "main";
}
const insertCreator = db.prepare(
  "INSERT INTO post_creators (username, display_name, source) VALUES (?, ?, 'import')"
);
const insertPost = db.prepare(
  "INSERT INTO posts (author_creator_id, caption) VALUES (?, ?)"
);
const insertMedia = db.prepare(
  `INSERT INTO post_media (post_id, storage_key, mime_type, width, height, position, content_hash)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);
const insertHashtag = db.prepare(
  "INSERT OR IGNORE INTO post_hashtags (post_id, tag) VALUES (?, ?)"
);
// Has this creator already got an image with this exact content?
const hashSeen = db.prepare(
  `SELECT 1 FROM post_media pm JOIN posts p ON p.id = pm.post_id
    WHERE p.author_creator_id = ? AND pm.content_hash = ? LIMIT 1`
);

const MAX_PER_POST = 10;
function dateKey(name) {
  let m = name.match(/-(\d{8})-/);
  if (m) return m[1];
  m = name.match(/-(\d{2}-\d{2}-\d{4})-/);
  if (m) return m[1];
  return null;
}

// gallery-dl writes a `<file>.json` sidecar (--write-metadata) with the post's
// caption, shortcode, and date. Read it for an image/video source, if present.
function readSidecar(srcPath) {
  try {
    const d = JSON.parse(fs.readFileSync(`${srcPath}.json`, "utf8"));
    return {
      caption: typeof d.description === "string" ? d.description : null,
      shortcode: d.post_shortcode || d.shortcode || null,
    };
  } catch {
    return null;
  }
}
function consumeSidecar(srcPath) {
  try { fs.unlinkSync(`${srcPath}.json`); } catch { /* none / best effort */ }
}

// Unique lowercase #hashtags from a caption — mirrors parseHashtags in lib/posts.
function parseHashtags(caption) {
  if (!caption) return [];
  const tags = [];
  const re = /#([a-z0-9_]{1,50})/gi;
  let m;
  while ((m = re.exec(caption)) !== null) {
    const t = m[1].toLowerCase();
    if (!tags.includes(t)) tags.push(t);
  }
  return tags;
}

// Group processed images (sorted by filename) into carousels: same Instagram
// shortcode (or, for non-IG drops, same source date) = one post, capped at 10;
// items with neither key each get their own post.
function groupItems(items) {
  const groups = [];
  let cur = [];
  let curKey;
  for (const it of items) {
    const k = it.shortcode || dateKey(it.file);
    if (cur.length === 0) { cur = [it]; curKey = k; }
    else if (k !== null && k === curKey && cur.length < MAX_PER_POST) cur.push(it);
    else { groups.push(cur); cur = [it]; curKey = k; }
  }
  if (cur.length) groups.push(cur);
  return groups;
}

let imported = 0;
let creatorsNew = 0;
let skipped = 0;
const creatorCache = new Map();
// creatorId -> [{ file, storageKey, width, height }]
const byCreator = new Map();

function resolveCreatorId(username) {
  let creatorId = creatorCache.get(username);
  if (!creatorId) {
    const row = findCreator.get(username);
    if (row) creatorId = row.id;
    else {
      creatorId = Number(insertCreator.run(username, username).lastInsertRowid);
      creatorsNew++;
      log(`creator + ${username}`);
    }
    creatorCache.set(username, creatorId);
  }
  return creatorId;
}

// Try to consume (delete) a source; returns false if we can't (host-owned drop
// the container can't unlink) so the caller leaves it for a retry.
function consume(srcPath) {
  try {
    fs.unlinkSync(srcPath);
    return true;
  } catch {
    return false;
  }
}

let deduped = 0;
let videosRouted = 0;

// Move a video out of the photo drop into the main shorts import folder, named
// for the creator, so the shorts importer makes a clip under the same handle.
function routeVideo(username, srcPath, originalName) {
  const dropDir = shortsVideoDrop(creatorChannel(username));
  fs.mkdirSync(dropDir, { recursive: true });
  const dest = path.join(dropDir, `${username}_-_${path.basename(originalName)}`);
  const sidecar = readSidecar(srcPath);
  try {
    fs.copyFileSync(srcPath, dest);
    if (!consume(srcPath)) {
      try { fs.unlinkSync(dest); } catch {}
      log(`skip video ${originalName}: can't consume source`);
      skipped++;
      return;
    }
    consumeSidecar(srcPath);
    // Carry the Instagram caption to the shorts importer via a .md sidecar named
    // for the routed video's stem (import-shorts reads it as the clip caption).
    if (sidecar?.caption) {
      const destStem = dest.slice(0, dest.length - path.extname(dest).length);
      try { fs.writeFileSync(`${destStem}.md`, sidecar.caption); } catch { /* best effort */ }
    }
    videosRouted++;
  } catch (err) {
    log(`skip video ${originalName}: ${err.message}`);
    skipped++;
  }
}

// Transcode one image into the creator's folder and queue it for grouping.
// originalName is used only for date-based carousel grouping; consumed on success.
async function processImage(username, srcPath, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  if (!IMG_EXTS.has(ext)) return;
  const creatorId = resolveCreatorId(username);

  const folder = slug(username);
  const destDir = path.join(POSTS_ROOT, folder);
  fs.mkdirSync(destDir, { recursive: true });
  const uuid = randomUUID();
  const storageKey = `${folder}/${uuid}.jpg`;

  const displayPath = path.join(destDir, `${uuid}.jpg`);
  const thumbPath = path.join(destDir, `${uuid}_t.jpg`);
  const sidecar = readSidecar(srcPath);
  try {
    const source =
      (ext === ".heic" || ext === ".heif") && isHeif(srcPath)
        ? heicToJpeg(srcPath)
        : fs.readFileSync(srcPath);
    const upright = await sharp(source).rotate().toBuffer();
    const meta = await sharp(upright).metadata();
    const displayBuf = await sharp(upright)
      .resize(DISPLAY_MAX, DISPLAY_MAX, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();

    // Dedup on the transcoded display bytes (deterministic for a given source),
    // so re-dropping an already-imported image is skipped. Matches the backfill,
    // which hashes the same display files.
    const contentHash = crypto.createHash("sha256").update(displayBuf).digest("hex");
    if (hashSeen.get(creatorId, contentHash)) {
      if (consume(srcPath)) { consumeSidecar(srcPath); deduped++; }
      return; // already imported
    }

    fs.writeFileSync(displayPath, displayBuf);
    await sharp(upright)
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: "cover" })
      .jpeg({ quality: 75 })
      .toFile(thumbPath);

    // Consume the source FIRST. If we can't delete it (e.g. a host-owned drop
    // the container can't unlink), back out the files we just wrote and skip —
    // otherwise the leftover source re-imports as a duplicate on the next run.
    if (!consume(srcPath)) {
      try { fs.unlinkSync(displayPath); } catch {}
      try { fs.unlinkSync(thumbPath); } catch {}
      log(`skip ${originalName}: can't consume source`);
      skipped++;
      return;
    }

    consumeSidecar(srcPath);
    if (!byCreator.has(creatorId)) byCreator.set(creatorId, []);
    byCreator.get(creatorId).push({
      file: originalName,
      storageKey,
      width: meta.width ?? null,
      height: meta.height ?? null,
      contentHash,
      // Prefer a gallery-dl/IG sidecar caption; otherwise derive title + #tags
      // from a bracketed filename ("title [h_tag][f_creator].jpg").
      caption:
        sidecar?.caption ??
        captionFromStem(
          originalName.slice(0, originalName.length - ext.length)
        ),
      shortcode: sidecar?.shortcode ?? null,
    });
    imported++;
  } catch (err) {
    try { fs.unlinkSync(displayPath); } catch {}
    try { fs.unlinkSync(thumbPath); } catch {}
    log(`skip ${originalName}: ${err.message}`);
    skipped++;
  }
}

// Dispatch a single file: images become posts, videos get routed to shorts,
// anything else is ignored.
async function handleFile(username, srcPath, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  if (IMG_EXTS.has(ext)) await processImage(username, srcPath, originalName);
  else if (VIDEO_EXTS.has(ext)) routeVideo(username, srcPath, originalName);
}

const entries = fs.readdirSync(IMPORT_DIR, { withFileTypes: true });

for (const entry of entries) {
  if (entry.name.startsWith(".")) continue;
  if (entry.isFile()) {
    // Top-level file: the creator is encoded in the filename.
    const stem = entry.name.slice(0, entry.name.length - path.extname(entry.name).length);
    await handleFile(creatorUsername(parseCreator(stem)), path.join(IMPORT_DIR, entry.name), entry.name);
  } else if (entry.isDirectory()) {
    // Subfolder: the FOLDER NAME is the creator; every image inside goes to it
    // and videos route to shorts (filenames don't matter). One level deep. A bad
    // folder must not abort the whole run.
    const username = creatorUsername(entry.name);
    const dir = path.join(IMPORT_DIR, entry.name);
    try {
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith(".")) continue;
        const fp = path.join(dir, f);
        try {
          if (fs.statSync(fp).isFile()) await handleFile(username, fp, f);
        } catch (err) {
          log(`skip ${entry.name}/${f}: ${err.message}`);
          skipped++;
        }
      }
      // Remove the now-consumed folder (best effort).
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch (err) {
      log(`skip folder ${entry.name}: ${err.message}`);
    }
  }
}

// Group each creator's images into carousel posts (by IG shortcode, else date),
// carrying the caption + hashtags from the gallery-dl metadata sidecar.
for (const [creatorId, items] of byCreator) {
  items.sort((a, b) => a.file.localeCompare(b.file));
  for (const group of groupItems(items)) {
    const caption = group.find((m) => m.caption)?.caption ?? null;
    const cap = caption ? caption.slice(0, 2200) : null;
    const postId = Number(insertPost.run(creatorId, cap).lastInsertRowid);
    group.forEach((m, i) =>
      insertMedia.run(postId, m.storageKey, "image/jpeg", m.width, m.height, i, m.contentHash)
    );
    if (cap) for (const tag of parseHashtags(cap)) insertHashtag.run(postId, tag);
  }
}

log(
  `done: ${imported} imported, ${creatorsNew} new creators, ` +
    `${videosRouted} videos→shorts, ${deduped} dup-skipped, ${skipped} skipped`
);
result({ imported, creatorsNew, videosRouted, deduped, skipped });
db.close();
