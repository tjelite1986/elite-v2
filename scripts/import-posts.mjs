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
import sharp from "sharp";

const DATA_DIR = process.env.DATA_DIR || "/app/data";
const DB_PATH = path.join(DATA_DIR, "elitev2.db");
const POSTS_ROOT = process.env.POSTS_ROOT || "/posts-store";
const IMPORT_DIR = process.env.POSTS_IMPORT_DIR || path.join(POSTS_ROOT, "_import");

const IMG_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"]);
const DISPLAY_MAX = 1440;
const THUMB_SIZE = 600;

const log = (m) => console.log(`[import-posts] ${m}`);
const result = (obj) => console.log(`RESULT ${JSON.stringify(obj)}`);

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

function parseCreator(stem) {
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
const insertCreator = db.prepare(
  "INSERT INTO post_creators (username, display_name, source) VALUES (?, ?, 'import')"
);
const insertPost = db.prepare(
  "INSERT INTO posts (author_creator_id, caption) VALUES (?, NULL)"
);
const insertMedia = db.prepare(
  `INSERT INTO post_media (post_id, storage_key, mime_type, width, height, position)
   VALUES (?, ?, ?, ?, ?, ?)`
);

const MAX_PER_POST = 10;
function dateKey(name) {
  let m = name.match(/-(\d{8})-/);
  if (m) return m[1];
  m = name.match(/-(\d{2}-\d{2}-\d{4})-/);
  if (m) return m[1];
  return null;
}
// Group processed images (sorted by filename) into carousels: same source date
// = one post, capped at 10; undated images each their own post.
function groupByDate(items) {
  const groups = [];
  let cur = [];
  let curKey;
  for (const it of items) {
    const k = dateKey(it.file);
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
  try {
    const source =
      ext === ".heic" || ext === ".heif"
        ? heicToJpeg(srcPath)
        : fs.readFileSync(srcPath);
    const upright = await sharp(source).rotate().toBuffer();
    const meta = await sharp(upright).metadata();
    await sharp(upright)
      .resize(DISPLAY_MAX, DISPLAY_MAX, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toFile(displayPath);
    await sharp(upright)
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: "cover" })
      .jpeg({ quality: 75 })
      .toFile(thumbPath);

    // Consume the source FIRST. If we can't delete it (e.g. a host-owned drop
    // the container can't unlink), back out the files we just wrote and skip —
    // otherwise the leftover source re-imports as a duplicate on the next run.
    try {
      fs.unlinkSync(srcPath);
    } catch (unlinkErr) {
      try { fs.unlinkSync(displayPath); } catch {}
      try { fs.unlinkSync(thumbPath); } catch {}
      log(`skip ${originalName}: can't consume source (${unlinkErr.code || unlinkErr.message})`);
      skipped++;
      return;
    }

    if (!byCreator.has(creatorId)) byCreator.set(creatorId, []);
    byCreator.get(creatorId).push({
      file: originalName,
      storageKey,
      width: meta.width ?? null,
      height: meta.height ?? null,
    });
    imported++;
  } catch (err) {
    try { fs.unlinkSync(displayPath); } catch {}
    try { fs.unlinkSync(thumbPath); } catch {}
    log(`skip ${originalName}: ${err.message}`);
    skipped++;
  }
}

const entries = fs.readdirSync(IMPORT_DIR, { withFileTypes: true });

for (const entry of entries) {
  if (entry.name.startsWith(".")) continue;
  if (entry.isFile()) {
    // Top-level file: the creator is encoded in the filename.
    const stem = entry.name.slice(0, entry.name.length - path.extname(entry.name).length);
    await processImage(
      creatorUsername(parseCreator(stem)),
      path.join(IMPORT_DIR, entry.name),
      entry.name
    );
  } else if (entry.isDirectory()) {
    // Subfolder: the FOLDER NAME is the creator; every image inside goes to it
    // (filenames don't matter). One level deep. A bad folder must not abort the
    // whole run.
    const username = creatorUsername(entry.name);
    const dir = path.join(IMPORT_DIR, entry.name);
    try {
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith(".")) continue;
        const fp = path.join(dir, f);
        try {
          if (fs.statSync(fp).isFile()) await processImage(username, fp, f);
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

// Group each creator's images by source date into carousel posts.
for (const [creatorId, items] of byCreator) {
  items.sort((a, b) => a.file.localeCompare(b.file));
  for (const group of groupByDate(items)) {
    const postId = Number(insertPost.run(creatorId).lastInsertRowid);
    group.forEach((m, i) =>
      insertMedia.run(postId, m.storageKey, "image/jpeg", m.width, m.height, i)
    );
  }
}

log(`done: ${imported} imported, ${creatorsNew} new creators, ${skipped} skipped`);
result({ imported, creatorsNew, skipped });
db.close();
