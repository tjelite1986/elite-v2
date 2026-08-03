#!/usr/bin/env node
// Give every post a randomly generated caption with a few random hashtags.
//
// This exists for the SANDBOX instance (elitev2-test), where imported
// placeholder photos otherwise sit there captionless and the feed, the search
// index and the hashtag pages have nothing to show in a screenshot. It
// OVERWRITES existing captions, so it is dry-run by default and needs --yes.
//
// Usage (inside the container):
//   node scripts/seed-sandbox-captions.mjs            # report only
//   node scripts/seed-sandbox-captions.mjs --yes      # write
//   node scripts/seed-sandbox-captions.mjs --yes --only-empty
//
// posts_fts is kept in sync by triggers; post_hashtags is rewritten here.

import path from "node:path";
import Database from "better-sqlite3";

const DATA_DIR = process.env.DATA_DIR || "/app/data";
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "elitev2.db");

const WRITE = process.argv.includes("--yes");
const ONLY_EMPTY = process.argv.includes("--only-empty");

const OPENERS = [
  "Caught this one on the way home",
  "Still thinking about this light",
  "Found this in an old folder",
  "No filter needed here",
  "Shot this handheld and got lucky",
  "Somewhere between morning and coffee",
  "This one took three tries",
  "Straight out of camera",
  "A quiet corner worth remembering",
  "Testing an old lens again",
  "The colours did all the work",
  "Almost deleted this one",
  "Golden hour never misses",
  "Not my usual thing, but here we are",
  "Same street, different weather",
];

const CLOSERS = [
  "Worth the detour.",
  "Might print this one.",
  "Let me know what you think.",
  "Still my favourite spot.",
  "More from this roll soon.",
  "Cropped it to death and went back to the original.",
  "The rest of the set was a mess.",
  "Turned out better than expected.",
  "",
  "",
];

const TAGS = [
  "photography", "film", "analog", "streetphoto", "goldenhour", "landscape",
  "portrait", "nofilter", "vintage", "35mm", "travel", "citylife", "nature",
  "minimal", "moody", "everyday", "weekend", "archive", "snapshot", "colour",
];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function randomCaption() {
  const count = 2 + Math.floor(Math.random() * 3); // 2-4 tags
  const tags = [];
  while (tags.length < count) {
    const t = pick(TAGS);
    if (!tags.includes(t)) tags.push(t);
  }
  const closer = pick(CLOSERS);
  const text = closer ? `${pick(OPENERS)}. ${closer}` : `${pick(OPENERS)}.`;
  return { caption: `${text} ${tags.map((t) => `#${t}`).join(" ")}`, tags };
}

const db = new Database(DB_PATH);
db.pragma("busy_timeout = 5000");

const rows = db
  .prepare(
    `SELECT id, caption FROM posts WHERE is_deleted = 0` +
      (ONLY_EMPTY ? ` AND (caption IS NULL OR caption = '')` : "")
  )
  .all();

console.log(`[seed-captions] db=${DB_PATH} posts=${rows.length}${WRITE ? "" : " (dry run)"}`);

if (!WRITE) {
  for (const r of rows.slice(0, 5)) {
    console.log(`  #${r.id}: ${randomCaption().caption}`);
  }
  console.log("[seed-captions] nothing written — pass --yes to apply");
  process.exit(0);
}

const setCaption = db.prepare("UPDATE posts SET caption = ? WHERE id = ?");
const clearTags = db.prepare("DELETE FROM post_hashtags WHERE post_id = ?");
const addTag = db.prepare("INSERT OR IGNORE INTO post_hashtags (post_id, tag) VALUES (?, ?)");

const apply = db.transaction((items) => {
  for (const r of items) {
    const { caption, tags } = randomCaption();
    setCaption.run(caption, r.id);
    clearTags.run(r.id);
    for (const t of tags) addTag.run(r.id, t);
  }
});

apply(rows);
console.log(`[seed-captions] done: ${rows.length} captions written`);
console.log(`RESULT ${JSON.stringify({ posts: rows.length })}`);
