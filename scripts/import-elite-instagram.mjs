#!/usr/bin/env node
// One-off seed: import the on-disk instagram library (per-creator folders) into
// the posts module as mirrored creators. Reads the READ-ONLY bind mount
// /elite-src/instagram (host /mnt/4tb/elite), transcodes a display + thumb into
// each creator's posts folder, and inserts one post per image.
//
// Run inside the container:  docker exec elitev2 node scripts/import-elite-instagram.mjs [creatorLimit]
//
// Idempotent at creator granularity: a creator that already has >=1 post is
// skipped, so the job can be re-run / resumed. Heavy (thousands of images) — run
// detached / in the background.

import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const DATA_DIR = process.env.DATA_DIR || "/app/data";
const DB_PATH = path.join(DATA_DIR, "elitev2.db");
const POSTS_ROOT = process.env.POSTS_ROOT || "/posts-store";
const SRC = process.env.IG_SRC || "/elite-src/instagram";
const CREATOR_LIMIT = Number(process.argv[2]) || Infinity;

const IMG_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const DISPLAY_MAX = 1440;
const THUMB_SIZE = 600;
const log = (m) => console.log(`[seed-instagram] ${m}`);

function username(name) {
  const s = (name || "unknown").trim().toLowerCase()
    .replace(/[^a-z0-9._]+/g, "").replace(/^[._]+|[._]+$/g, "").slice(0, 30);
  return s || "unknown";
}
function slug(name) {
  const s = (name || "unknown").trim().toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_").replace(/^[._-]+|[._-]+$/g, "").slice(0, 64);
  return s || "unknown";
}

if (!fs.existsSync(SRC)) {
  log(`source not found: ${SRC}`);
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 20000");

const findCreator = db.prepare("SELECT id FROM post_creators WHERE username = ?");
const insertCreator = db.prepare(
  "INSERT INTO post_creators (username, display_name, source) VALUES (?, ?, 'instagram')"
);
const creatorPostCount = db.prepare(
  "SELECT COUNT(*) AS c FROM posts WHERE author_creator_id = ?"
);
const insertPost = db.prepare("INSERT INTO posts (author_creator_id, caption) VALUES (?, NULL)");
const insertMedia = db.prepare(
  `INSERT INTO post_media (post_id, storage_key, mime_type, width, height, position)
   VALUES (?, ?, ?, ?, ?, 0)`
);

const folders = fs.readdirSync(SRC, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
  .map((e) => e.name)
  .sort();

let creatorsDone = 0;
let imported = 0;

for (const folder of folders) {
  if (creatorsDone >= CREATOR_LIMIT) break;
  const uname = username(folder);

  let creatorId = findCreator.get(uname)?.id;
  if (creatorId && creatorPostCount.get(creatorId).c > 0) continue; // already seeded
  if (!creatorId) {
    creatorId = Number(insertCreator.run(uname, folder).lastInsertRowid);
  }

  const srcDir = path.join(SRC, folder);
  const destDir = path.join(POSTS_ROOT, slug(uname));
  fs.mkdirSync(destDir, { recursive: true });

  const files = fs.readdirSync(srcDir)
    .filter((f) => IMG_EXTS.has(path.extname(f).toLowerCase()));

  let count = 0;
  for (const f of files) {
    try {
      const buf = fs.readFileSync(path.join(srcDir, f));
      const upright = await sharp(buf).rotate().toBuffer();
      const meta = await sharp(upright).metadata();
      const uuid = randomUUID();
      await sharp(upright)
        .resize(DISPLAY_MAX, DISPLAY_MAX, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toFile(path.join(destDir, `${uuid}.jpg`));
      await sharp(upright)
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: "cover" })
        .jpeg({ quality: 75 })
        .toFile(path.join(destDir, `${uuid}_t.jpg`));
      const postId = Number(insertPost.run(creatorId).lastInsertRowid);
      insertMedia.run(postId, `${slug(uname)}/${uuid}.jpg`, "image/jpeg",
        meta.width ?? null, meta.height ?? null);
      imported++;
      count++;
    } catch (err) {
      log(`skip ${folder}/${f}: ${err.message}`);
    }
  }
  creatorsDone++;
  log(`${uname}: ${count} images (${creatorsDone}/${folders.length} creators, ${imported} total)`);
}

log(`done: ${imported} images across ${creatorsDone} creators`);
db.close();
