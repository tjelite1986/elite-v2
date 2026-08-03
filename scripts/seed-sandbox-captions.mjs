#!/usr/bin/env node
// Fill every library's free-text field with generated content: captions with
// random hashtags for posts, gallery items, shorts and videos; a bio for each
// user profile; an author name for each book.
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
//   node scripts/seed-sandbox-captions.mjs --yes --gallery   # one section only
//
// Sections: posts, gallery, shorts, videos, books, profiles (all by default).
//
// posts_fts and gallery_fts are kept in sync by triggers; post_hashtags and
// gallery_tags are rewritten here. Shorts have no tag table at all — their
// categories are derived from the #tags in the caption (see lib/shorts.ts).

import path from "node:path";
import Database from "better-sqlite3";

const DATA_DIR = process.env.DATA_DIR || "/app/data";
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "elitev2.db");

const WRITE = process.argv.includes("--yes");
const ONLY_EMPTY = process.argv.includes("--only-empty");
// Default is every section; naming one or more limits the run to those.
const NAMES = ["posts", "gallery", "shorts", "videos", "books", "profiles"];
const picked = NAMES.filter((n) => process.argv.includes(`--${n}`));
const wanted = picked.length ? picked : NAMES;

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

function randomTags() {
  const count = 2 + Math.floor(Math.random() * 3); // 2-4 tags
  const tags = [];
  while (tags.length < count) {
    const t = pick(TAGS);
    if (!tags.includes(t)) tags.push(t);
  }
  return tags;
}

function randomCaption() {
  const tags = randomTags();
  const closer = pick(CLOSERS);
  const text = closer ? `${pick(OPENERS)}. ${closer}` : `${pick(OPENERS)}.`;
  return { caption: `${text} ${tags.map((t) => `#${t}`).join(" ")}`, tags };
}

const BIOS = [
  "Shoots more than she posts",
  "Two cameras, no plan",
  "Collecting light on the way to work",
  "Mostly film, occasionally patient",
  "Here for the quiet frames",
  "Rolls developed when the fridge is full",
];

function randomBio() {
  const tags = randomTags().slice(0, 2);
  return { caption: `${pick(BIOS)}. ${tags.map((t) => `#${t}`).join(" ")}`, tags };
}

const FIRST = ["Alex", "Mira", "Jonas", "Petra", "Sam", "Ida", "Nils", "Rosa"];
const LAST = ["Lindqvist", "Hartmann", "Okafor", "Beaumont", "Vasquez", "Sund", "Iyer"];

// Books have no free-text field a hashtag belongs in — the only blank worth
// filling is the author a CBZ/PDF drop never carries.
function randomAuthor() {
  return { caption: `${pick(FIRST)} ${pick(LAST)}`, tags: [] };
}

const db = new Database(DB_PATH);
db.pragma("busy_timeout = 5000");

// Posts and gallery items work the same way: a text column on the row, plus a
// tag table keyed by that row's id. Shorts have no tag table — the #tags in the
// caption ARE the categories.
const SECTIONS = {
  posts: {
    select: `SELECT id FROM posts WHERE is_deleted = 0` +
      (ONLY_EMPTY ? ` AND (caption IS NULL OR caption = '')` : ""),
    setText: "UPDATE posts SET caption = ? WHERE id = ?",
    clearTags: "DELETE FROM post_hashtags WHERE post_id = ?",
    addTag: "INSERT OR IGNORE INTO post_hashtags (post_id, tag) VALUES (?, ?)",
  },
  gallery: {
    select: `SELECT id FROM gallery_items WHERE is_deleted = 0` +
      (ONLY_EMPTY ? ` AND (description IS NULL OR description = '')` : ""),
    setText: "UPDATE gallery_items SET description = ? WHERE id = ?",
    clearTags: "DELETE FROM gallery_tags WHERE item_id = ?",
    addTag: "INSERT OR IGNORE INTO gallery_tags (item_id, tag) VALUES (?, ?)",
  },
  shorts: {
    select: `SELECT id FROM shorts WHERE is_deleted = 0` +
      (ONLY_EMPTY ? ` AND (caption IS NULL OR caption = '')` : ""),
    setText: "UPDATE shorts SET caption = ? WHERE id = ?",
    clearTags: null,
    addTag: null,
  },
  videos: {
    select: `SELECT id FROM videos` +
      (ONLY_EMPTY ? ` WHERE (description IS NULL OR description = '')` : ""),
    setText: "UPDATE videos SET description = ? WHERE id = ?",
    clearTags: null,
    addTag: null,
  },
  books: {
    // Books carry no caption — `author` is the blank a CBZ/PDF drop leaves.
    select: `SELECT slug AS id FROM books` +
      (ONLY_EMPTY ? ` WHERE (author IS NULL OR author = '')` : ""),
    setText: "UPDATE books SET author = ? WHERE slug = ?",
    clearTags: null,
    addTag: null,
    text: randomAuthor,
  },
  profiles: {
    // The bio the profile page renders lives in profile_extras (handle-scoped),
    // NOT in the legacy user_profiles.bio column, which nothing reads.
    select: `SELECT handle AS id FROM profile_extras` +
      (ONLY_EMPTY ? ` WHERE (bio IS NULL OR bio = '')` : ""),
    setText: "UPDATE profile_extras SET bio = ? WHERE handle = ?",
    clearTags: null,
    addTag: null,
    text: randomBio,
  },
};

const result = {};

for (const name of wanted) {
  const s = SECTIONS[name];
  const makeText = s.text ?? randomCaption;
  const rows = db.prepare(s.select).all();
  result[name] = rows.length;
  console.log(
    `[seed-captions] db=${DB_PATH} ${name}=${rows.length}${WRITE ? "" : " (dry run)"}`
  );

  if (!WRITE) {
    for (const r of rows.slice(0, 3)) {
      console.log(`  ${name} #${r.id}: ${makeText().caption}`);
    }
    continue;
  }

  const setText = db.prepare(s.setText);
  const clearTags = s.clearTags ? db.prepare(s.clearTags) : null;
  const addTag = s.addTag ? db.prepare(s.addTag) : null;

  db.transaction((items) => {
    for (const r of items) {
      const { caption, tags } = makeText();
      setText.run(caption, r.id);
      if (clearTags && addTag) {
        clearTags.run(r.id);
        for (const t of tags) addTag.run(r.id, t);
      }
    }
  })(rows);

  console.log(`[seed-captions] done: ${rows.length} ${name} captions written`);
}

if (!WRITE) {
  console.log("[seed-captions] nothing written — pass --yes to apply");
}
console.log(`RESULT ${JSON.stringify(result)}`);
