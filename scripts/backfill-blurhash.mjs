#!/usr/bin/env node
// One-time backfill: compute a blurhash placeholder for every gallery item
// that lacks one, from its thumb (new items get it at ingest). Thumb path
// resolution mirrors lib/gallery-storage.ts (per-user tree, legacy fallback).

import Database from "better-sqlite3";
import sharp from "sharp";
import { encode } from "blurhash";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "/app/data";
const DB_PATH = path.join(DATA_DIR, "elitev2.db");
const PROFILE_ROOT = process.env.PROFILE_ROOT || path.join(DATA_DIR, "profile");
const GALLERY_ROOT = process.env.GALLERY_ROOT || path.join(DATA_DIR, "gallery");

const log = (m) => console.log(`[backfill-blurhash] ${m}`);

const db = new Database(DB_PATH);
db.pragma("busy_timeout = 15000");
db.pragma("journal_mode = WAL");

const userSlug = (username, userId) => {
  const slug = (username || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 64);
  return `u_${slug || userId}`;
};

const thumbPathFor = (userId, username, storageKey) => {
  const uuid = path.basename(storageKey).replace(/\.[^.]+$/, "");
  const perUser = path.join(PROFILE_ROOT, userSlug(username, userId), "gallery", "thumbs", `${uuid}.jpg`);
  if (fs.existsSync(perUser)) return perUser;
  const legacy = path.join(GALLERY_ROOT, "thumbs", String(userId), `${uuid}.jpg`);
  return fs.existsSync(legacy) ? legacy : null;
};

const rows = db
  .prepare(
    `SELECT g.id, g.user_id, g.storage_key, up.username
       FROM gallery_items g
       LEFT JOIN user_profiles up ON up.user_id = g.user_id
      WHERE g.blurhash IS NULL AND g.is_deleted = 0`
  )
  .all();
log(`${rows.length} items without a blurhash`);

const update = db.prepare("UPDATE gallery_items SET blurhash = ? WHERE id = ?");
let done = 0;
let missing = 0;
let failed = 0;
for (const r of rows) {
  const thumb = thumbPathFor(r.user_id, r.username, r.storage_key);
  if (!thumb) {
    missing++;
    continue;
  }
  try {
    const { data, info } = await sharp(thumb)
      .resize(32, 32, { fit: "inside" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    update.run(encode(new Uint8ClampedArray(data), info.width, info.height, 4, 3), r.id);
    done++;
  } catch {
    failed++;
  }
  if (done % 500 === 0 && done > 0) log(`${done}/${rows.length}...`);
}

log(`done: ${done} hashed, ${missing} thumbs missing, ${failed} failed`);
db.close();
