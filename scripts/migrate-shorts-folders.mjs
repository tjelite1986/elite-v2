#!/usr/bin/env node
// One-time migration: reorganize flat shorts storage into per-profile subfolders
// (shorts/<channel>/<profile-slug>/<file>), matching the layout the poller and
// uploader now write. Moves the video + poster on disk and rewrites the row's
// storage_key/poster_key to the new relative paths. Idempotent — rows whose
// key already contains a "/" are skipped. Run inside the container via docker exec.

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "/app/data";
const DB_PATH = path.join(DATA_DIR, "elitev2.db");
const SHORTS_ROOT = process.env.SHORTS_ROOT || "/shorts-store";
const UPLOADS_SUBDIR = "_uploads";

const log = (m) => console.log(`[migrate-shorts] ${m}`);

function channelDir(channel) {
  return path.join(SHORTS_ROOT, channel === "18plus" ? "18plus" : "main");
}

// Must stay identical to lib/shorts-storage.ts profileSlug().
function profileSlug(name) {
  const slug = (name || "unknown")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 64);
  return slug || "unknown";
}

const db = new Database(DB_PATH);
db.pragma("busy_timeout = 10000");

const rows = db
  .prepare(
    `SELECT s.id, s.channel, s.storage_key, s.poster_key, s.profile_id,
            p.name AS profile_name
       FROM shorts s
       LEFT JOIN short_profiles p ON p.id = s.profile_id
      WHERE s.is_deleted = 0`
  )
  .all();

let moved = 0;
let skipped = 0;
let missing = 0;

const update = db.prepare(
  "UPDATE shorts SET storage_key = ?, poster_key = ? WHERE id = ?"
);

// Move one file from <dir>/<rel> into <dir>/<subfolder>/<basename>; returns the
// new relative key, or the original key if there's nothing to move.
function moveInto(dir, rel, subfolder) {
  if (!rel) return rel;
  if (rel.includes("/")) return rel; // already namespaced
  const from = path.join(dir, rel);
  const destDir = path.join(dir, subfolder);
  const to = path.join(destDir, rel);
  if (!fs.existsSync(from)) {
    missing++;
    return rel; // leave key as-is; file is gone
  }
  fs.mkdirSync(destDir, { recursive: true });
  fs.renameSync(from, to);
  return `${subfolder}/${rel}`;
}

for (const row of rows) {
  if (row.storage_key && row.storage_key.includes("/")) {
    skipped++;
    continue;
  }
  const subfolder = row.profile_id
    ? profileSlug(row.profile_name)
    : UPLOADS_SUBDIR;
  const dir = channelDir(row.channel);

  const newStorage = moveInto(dir, row.storage_key, subfolder);
  const newPoster = moveInto(dir, row.poster_key, subfolder);

  if (newStorage !== row.storage_key || newPoster !== row.poster_key) {
    update.run(newStorage, newPoster, row.id);
    moved++;
    log(`#${row.id} ${row.channel} -> ${subfolder}/`);
  }
}

log(`done: ${moved} moved, ${skipped} already namespaced, ${missing} missing files`);
db.close();
