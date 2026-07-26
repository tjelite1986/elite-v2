#!/usr/bin/env node
// Backfill captions for clips that were grabbed before the grabber carried the
// source page's title and tags: their caption is nothing but the "Source: <url>"
// line. Runs INSIDE the elitev2 container — spawned detached by the admin
// "Backfill captions" button or via `docker exec`. Reports progress via the
// single-row short_caption_state beacon the UI polls.
//
// Re-downloading those clips is NOT the fix: the shorts importer dedups on
// profile_id + the filename stem, and the grabber changes that added the
// metadata also changed the creator and title that stem is built from, so every
// clip would come back as a second copy. This rewrites the existing rows and
// touches no files.
//
// The caption's own source URL is the way home, so nothing else has to remember
// where a clip came from. Album URLs (erome and friends) resolve to a list, and
// the right item is picked by the media id in the stored filename; every other
// URL is resolved on its own.
//
// Args (any order):
//   main | 18plus      limit the run to one channel
//   --dry-run          report what would change, write nothing
// Output: human log lines + a final `RESULT {json}` line the API route parses.

import Database from "better-sqlite3";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "/app/data";
const DB_PATH = path.join(DATA_DIR, "elitev2.db");
const GRABBIT =
  process.env.GRABBIT_URL || process.env.LADDA_URL || "http://grabbit:3000";
const GRABBIT_HEADERS = {
  "x-grabbit-token": process.env.GRABBIT_INTERNAL_TOKEN || "",
};
const DELAY_MS = 800; // be gentle with the source between clips

const args = process.argv.slice(2);
const CHANNEL = args.find((a) => a === "main" || a === "18plus") || null;
const DRY_RUN = args.includes("--dry-run");

const log = (m) => console.log(`[backfill-captions] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const result = (obj) => console.log(`RESULT ${JSON.stringify(obj)}`);

// Mirrors lib/shorts-caption.ts — one field holding
// "title\n\n#tags\n\nSource: <url>", which the player splits back apart.
const HASHTAG_RE = /#([\p{L}\p{N}_]+)/gu;
const SOURCE_RE = /(?:^|\s)Source:\s*(https?:\/\/\S+)/i;

function splitCaption(caption) {
  const source = caption?.match(SOURCE_RE)?.[1] ?? null;
  const stripped = (caption ?? "").replace(SOURCE_RE, " ");
  const tags = stripped.match(HASHTAG_RE) ?? [];
  const title = stripped.replace(HASHTAG_RE, "").replace(/\s+/g, " ").trim();
  return { title, tags: Array.from(new Set(tags)), source };
}

function buildCaption(title, tags, source) {
  return [title.trim(), tags.join(" "), source ? `Source: ${source}` : ""]
    .filter(Boolean)
    .join("\n\n");
}

// Extractors differ on whether a tag carries its "#" and whether it is one
// word: YouTube hands back "Gabry Ponte", and a hashtag only survives a caption
// as a single token. Tags the title already spells out are dropped — TikTok
// descriptions carry their own hashtags inline.
function normalizeTags(tags, title) {
  const inTitle = new Set(
    (title.match(HASHTAG_RE) ?? []).map((t) => t.toLowerCase())
  );
  const out = [];
  for (const raw of Array.isArray(tags) ? tags : []) {
    const tag =
      "#" +
      String(raw)
        .replace(/^#+/, "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}_]+/gu, "");
    if (tag.length > 1 && !inTitle.has(tag) && !out.includes(tag)) out.push(tag);
  }
  return out;
}

// A description is usually the better caption — TikTok's title is a truncated
// copy of it — but YouTube fills its description with label credits and release
// dates, so a long one loses to the plain title.
const MAX_DESCRIPTION = 300;

function pickTitle({ title, description }) {
  const desc = (description || "").trim();
  const plain = (title || "").trim();
  if (desc && desc.length <= MAX_DESCRIPTION) return desc;
  return plain || desc;
}

// A title worth writing. A site with no text for a post hands back an id
// instead — Facebook a numeric one for every wordless clip, album pages the CDN
// filename — and swapping one id for another is not a caption, so those keep
// the plain source link. Judged on shape, not on whether it matches the stored
// filename: a clip named after its real title matches too.
function usableTitle(title) {
  if (!title) return false;
  if (/^[\d\s._-]+$/.test(title)) return false; // a numeric video id
  // A single word mixing letters and digits: a CDN id, never a caption.
  return !(/^[A-Za-z0-9]{6,16}$/.test(title) && /\d/.test(title) && /[A-Za-z]/.test(title));
}

// The media id an album item is matched on: the stored filename is
// "<creator>_-_<title>[ [f_…][id_…]].<ext>", and back when these clips were
// grabbed the title WAS the id. Falls back to the whole stem for the older
// naming, which has no creator prefix.
function mediaIdFromStorageKey(storageKey) {
  const base = String(storageKey || "").split("/").pop() || "";
  const stem = base
    .replace(/\.(web\.)?[a-z0-9]+$/i, "")
    .replace(/\s*\[[^\]]*\]/g, "")
    .trim();
  const i = stem.lastIndexOf("_-_");
  return (i >= 0 ? stem.slice(i + 3) : stem).trim().toLowerCase();
}

async function grabbit(pathname) {
  const r = await fetch(`${GRABBIT}${pathname}`, { headers: GRABBIT_HEADERS });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || "request failed");
  return j;
}

const db = new Database(DB_PATH);
db.pragma("busy_timeout = 15000");
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS short_caption_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    status TEXT NOT NULL DEFAULT 'idle',
    started_at TEXT,
    finished_at TEXT,
    processed INTEGER NOT NULL DEFAULT 0,
    updated INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    message TEXT
  );
`);

const setRunning = db.prepare(
  `INSERT INTO short_caption_state (id, status, started_at, finished_at, processed, updated, total, message)
   VALUES (1, 'running', datetime('now'), NULL, 0, 0, ?, NULL)
   ON CONFLICT(id) DO UPDATE SET
     status='running', started_at=datetime('now'), finished_at=NULL,
     processed=0, updated=0, total=excluded.total, message=NULL`
);
const updateProgress = db.prepare(
  "UPDATE short_caption_state SET processed = ?, updated = ? WHERE id = 1"
);
const setDone = db.prepare(
  `UPDATE short_caption_state
      SET status = ?, finished_at = datetime('now'), processed = ?, updated = ?, message = ?
    WHERE id = 1`
);
const setCaption = db.prepare("UPDATE shorts SET caption = ? WHERE id = ?");

// Clips whose caption is only a source link: no title text, no hashtags. A
// caption with either is the user's or the site's and is never touched.
function candidates() {
  const rows = db
    .prepare(
      `SELECT id, caption, storage_key
         FROM shorts
        WHERE is_deleted = 0
          AND caption LIKE '%Source:%'
          ${CHANNEL ? "AND channel = @channel" : ""}`
    )
    .all(CHANNEL ? { channel: CHANNEL } : {});

  // Grouped by source URL: an album gives every one of its clips the same URL,
  // and it should only be read once.
  const bySource = new Map();
  for (const r of rows) {
    const { title, tags, source } = splitCaption(r.caption);
    if (title || tags.length || !source) continue;
    if (!bySource.has(source)) bySource.set(source, []);
    bySource.get(source).push({ id: r.id, mediaId: mediaIdFromStorageKey(r.storage_key) });
  }
  return bySource;
}

// What the source page says about each clip. An album URL resolves to a list:
// pick the item whose media id matches the stored filename, falling back to the
// album's only video when there is exactly one of each — a clip named before
// the current filename grammar has no id to match on. Every other URL describes
// one clip and is resolved directly.
async function metaFor(url, clips) {
  const p = await grabbit(`/api/profile?url=${encodeURIComponent(url)}`);
  if (p.isProfile) {
    const videos = (p.items || []).filter((i) => i.mediaType !== "image");
    return clips.map((c) => {
      const item =
        videos.find((v) => String(v.id || "").toLowerCase() === c.mediaId) ??
        (videos.length === 1 && clips.length === 1 ? videos[0] : null);
      return [c, item];
    });
  }
  const meta = await grabbit(`/api/resolve?url=${encodeURIComponent(url)}`);
  return clips.map((c) => [c, meta]);
}

async function main() {
  const bySource = candidates();
  const clipCount = [...bySource.values()].reduce((n, v) => n + v.length, 0);
  setRunning.run(bySource.size);
  log(
    `${clipCount} clip(s) with a source-only caption across ${bySource.size} source(s)` +
      (CHANNEL ? ` (channel=${CHANNEL})` : "")
  );

  let processed = 0;
  let updated = 0;
  for (const [url, clips] of bySource) {
    try {
      for (const [clip, meta] of await metaFor(url, clips)) {
        if (!meta) continue;
        const raw = pickTitle(meta);
        const title = usableTitle(raw) ? raw : "";
        const tags = normalizeTags(meta.tags, title);
        // Nothing the source can add: leave the caption as the plain link.
        if (!title && !tags.length) continue;
        const caption = buildCaption(title, tags, url).slice(0, 2000);
        if (!DRY_RUN) setCaption.run(caption, clip.id);
        updated++;
        log(`${DRY_RUN ? "would set" : "set"} #${clip.id}: ${caption.split("\n")[0]}`);
      }
    } catch (err) {
      log(`skip ${url}: ${err.message}`);
    }
    processed++;
    updateProgress.run(processed, updated);
    if (processed < bySource.size) await sleep(DELAY_MS);
  }

  const message = `${updated} of ${clipCount} caption(s) updated from ${processed} source(s)${
    DRY_RUN ? " (dry run)" : ""
  }`;
  setDone.run("done", processed, updated, message);
  log(message);
  result({ sources: bySource.size, clips: clipCount, updated, dryRun: DRY_RUN });
}

main().catch((err) => {
  const msg = String(err?.message || err);
  log(`failed: ${msg}`);
  try {
    setDone.run("error", 0, 0, msg.slice(0, 500));
  } catch {
    /* the beacon is best-effort */
  }
  result({ error: msg });
  process.exit(1);
});
