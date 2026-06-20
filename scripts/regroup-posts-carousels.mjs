#!/usr/bin/env node
// One-off: regroup already-imported single-image creator posts into carousels,
// grouped by the date in the original source filename — WITHOUT re-encoding.
//
// The seed stored images under uuid names, so the date only survives in the
// read-only source (/elite-src/instagram/<folder>/<creator>-YYYYMMDD-NNNN.ext).
// Existing post_media rows for a creator, ordered by id, correspond 1:1 to the
// source files in readdir order (the order the seed processed them; the source
// is read-only and unchanged). So we pair them, sort by filename, group by date
// (<=10 per carousel), and re-parent the media into one post per group. Images
// never move between creators — worst case is slightly coarser grouping.
//
// Run inside the container:  docker exec elitev2 node scripts/regroup-posts-carousels.mjs [--run]
// Without --run it's a dry run (prints the plan, changes nothing).

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "/app/data";
const DB_PATH = path.join(DATA_DIR, "elitev2.db");
const SRC = process.env.IG_SRC || "/elite-src/instagram";
const DRY = !process.argv.includes("--run");

const IMG_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const MAX_PER_POST = 10;
const log = (m) => console.log(`[regroup] ${m}`);

function username(name) {
  const s = (name || "unknown").trim().toLowerCase()
    .replace(/[^a-z0-9._]+/g, "").replace(/^[._]+|[._]+$/g, "").slice(0, 30);
  return s || "unknown";
}
function dateKey(name) {
  let m = name.match(/-(\d{8})-/);
  if (m) return m[1];
  m = name.match(/-(\d{2}-\d{2}-\d{4})-/);
  if (m) return m[1];
  return null;
}

function groupByDate(pairs) {
  const groups = [];
  let cur = [];
  let curKey;
  for (const p of pairs) {
    const k = dateKey(p.file);
    if (cur.length === 0) {
      cur = [p];
      curKey = k;
    } else if (k !== null && k === curKey && cur.length < MAX_PER_POST) {
      cur.push(p);
    } else {
      groups.push(cur);
      cur = [p];
      curKey = k;
    }
  }
  if (cur.length) groups.push(cur);
  return groups;
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 20000");

const selCreator = db.prepare("SELECT id FROM post_creators WHERE username = ?");
const selMedia = db.prepare(
  `SELECT pm.id, pm.post_id FROM post_media pm
     JOIN posts p ON p.id = pm.post_id
    WHERE p.author_creator_id = ? AND p.is_deleted = 0
    ORDER BY pm.id ASC`
);
const reparent = db.prepare("UPDATE post_media SET post_id = ?, position = ? WHERE id = ?");
const mediaCount = db.prepare("SELECT COUNT(*) AS c FROM post_media WHERE post_id = ?");
const delPost = db.prepare("DELETE FROM posts WHERE id = ?");

const folders = fs.existsSync(SRC)
  ? fs.readdirSync(SRC, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
      .map((e) => e.name)
  : [];

let creatorsRegrouped = 0;
let fallbackCreators = 0;
let postsBefore = 0;
let postsAfter = 0;

const run = db.transaction((folder) => {
  const cr = selCreator.get(username(folder));
  if (!cr) return;
  const media = selMedia.all(cr.id);
  if (media.length === 0) return;

  const srcFiles = fs
    .readdirSync(path.join(SRC, folder))
    .filter((f) => IMG_EXTS.has(path.extname(f).toLowerCase()));

  let groups;
  if (srcFiles.length === media.length) {
    const pairs = media.map((m, i) => ({ media: m, file: srcFiles[i] }));
    pairs.sort((a, b) => a.file.localeCompare(b.file));
    groups = groupByDate(pairs);
  } else {
    // Counts diverged (the seed skipped a bad image) — fall back to even chunks
    // so the creator still gets carousels, just not date-accurate.
    groups = chunk(media.map((m) => ({ media: m })), MAX_PER_POST);
    fallbackCreators++;
  }

  const oldPostIds = Array.from(new Set(media.map((m) => m.post_id)));
  postsBefore += oldPostIds.length;
  postsAfter += groups.length;

  if (DRY) {
    creatorsRegrouped++;
    return;
  }

  // Re-parent each group's media into the group's first post; delete the rest.
  for (const g of groups) {
    const target = g[0].media.post_id;
    g.forEach((p, i) => reparent.run(target, i, p.media.id));
  }
  for (const pid of oldPostIds) {
    if (mediaCount.get(pid).c === 0) delPost.run(pid);
  }
  creatorsRegrouped++;
});

for (const folder of folders) {
  try {
    run(folder);
  } catch (err) {
    log(`skip ${folder}: ${err.message}`);
  }
}

log(
  `${DRY ? "DRY-RUN" : "DONE"}: ${creatorsRegrouped} creators, ` +
    `${postsBefore} posts -> ${postsAfter} carousels ` +
    `(${fallbackCreators} fell back to even chunks)`
);
db.close();
