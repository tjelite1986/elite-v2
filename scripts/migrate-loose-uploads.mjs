#!/usr/bin/env node
// One-time migration: move per-user uploaded shorts that were stored LOOSE
// (directly under u_<user>/shorts/<channel>/<file>, no subfolder) into a
// subfolder so no clip file sits without a folder. Subfolder = the creator
// parsed from a "profilname_-_title" filename, else the shared "uploads" dir —
// matching what storeShortUpload now writes for new uploads.
//
// Moves the video + poster on disk (keeps each basename; suffixes only on a real
// collision) and rewrites the row's storage_key/poster_key. Idempotent: rows
// already in a subfolder are skipped. DRY-RUN by default — pass --apply to move.
// Run inside the container:  docker exec elitev2 node scripts/migrate-loose-uploads.mjs [--apply]

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const APPLY = process.argv.includes("--apply");
const DATA_DIR = process.env.DATA_DIR || "/app/data";
const DB_PATH = path.join(DATA_DIR, "elitev2.db");
const PROFILE_ROOT = process.env.PROFILE_ROOT || "/profile-store";
const FALLBACK_DIR = "uploads";

const log = (m) => console.log(`[migrate-loose] ${m}`);

// --- mirror lib/shorts-storage.ts (kept identical) ----------------------------
const isUploadKey = (key) => /^u_[^/]+\/(?:shorts18|shorts)\//.test(key);

function profileSlug(name) {
  const slug = (name || "unknown")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 64);
  return slug || "unknown";
}

function splitExt(name) {
  if (name.toLowerCase().endsWith(".web.mp4")) {
    return [name.slice(0, -".web.mp4".length), ".web.mp4"];
  }
  const ext = path.extname(name);
  return [name.slice(0, name.length - ext.length), ext];
}

function profileFromFilename(filename) {
  const [stem] = splitExt(filename);
  const m = stem.match(/^(\S.+?)(?:_-_|\s-\s)/);
  const n = m ? m[1].trim() : "";
  return n || null;
}

// A LOOSE upload key has exactly four "/"-segments:
//   u_<user> / shorts / <channel> / <file>
// A foldered one has five (…/<subfolder>/<file>) and is left untouched.
function isLooseUpload(key) {
  return !!key && isUploadKey(key) && key.split("/").length === 4;
}

const db = new Database(DB_PATH);
db.pragma("busy_timeout = 10000");

const rows = db
  .prepare(
    "SELECT id, channel, storage_key, poster_key FROM shorts WHERE is_deleted = 0"
  )
  .all();

const update = db.prepare(
  "UPDATE shorts SET storage_key = ?, poster_key = ? WHERE id = ?"
);

let moved = 0;
let skipped = 0;
let missing = 0;

// Move <PROFILE_ROOT>/<oldKey> into <prefix>/<subfolder>/, keeping its basename
// (suffix only on a real name collision). Returns the new key, or the old key
// unchanged if the file is already gone from disk.
function moveInto(oldKey, subfolder) {
  const parts = oldKey.split("/"); // [u_user, shorts, channel, file]
  const baseName = parts[parts.length - 1];
  const prefix = parts.slice(0, 3).join("/"); // u_user/shorts/channel
  const from = path.join(PROFILE_ROOT, oldKey);
  if (!fs.existsSync(from)) {
    missing++;
    return oldKey; // file gone — leave the key as-is (orphan cleanup handles it)
  }
  const destDir = path.join(PROFILE_ROOT, prefix, subfolder);
  let finalBase = baseName;
  let to = path.join(destDir, finalBase);
  if (fs.existsSync(to) && path.resolve(from) !== path.resolve(to)) {
    const [stem, ext] = splitExt(baseName);
    finalBase = `${stem}_${randomUUID().slice(0, 8)}${ext}`;
    to = path.join(destDir, finalBase);
  }
  if (APPLY) {
    fs.mkdirSync(destDir, { recursive: true });
    fs.renameSync(from, to);
  }
  return `${prefix}/${subfolder}/${finalBase}`;
}

for (const row of rows) {
  if (!isLooseUpload(row.storage_key)) {
    skipped++;
    continue;
  }
  const baseName = row.storage_key.split("/").pop();
  const creator = profileFromFilename(baseName);
  const subfolder = creator ? profileSlug(creator) : FALLBACK_DIR;

  const newStorage = moveInto(row.storage_key, subfolder);
  // Keep the poster in the SAME subfolder as its video (only if it's also loose).
  let newPoster = row.poster_key;
  if (isLooseUpload(row.poster_key)) {
    newPoster = moveInto(row.poster_key, subfolder);
  }

  if (newStorage !== row.storage_key || newPoster !== row.poster_key) {
    if (APPLY) update.run(newStorage, newPoster, row.id);
    moved++;
    log(`#${row.id}: ${row.storage_key} -> ${newStorage}`);
  } else {
    skipped++;
  }
}

log(
  `${APPLY ? "APPLIED" : "DRY-RUN"} — moved ${moved}, skipped ${skipped}, missing-file ${missing}`
);
if (!APPLY) log("Re-run with --apply to perform the moves.");
db.close();
