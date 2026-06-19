#!/usr/bin/env node
// One-off import of the legacy elite shortvideos library (all TikTok) into the
// elite-v2 shorts "main" channel. Runs inside the container via docker exec with
// the old library mounted read-only at /elite-src.
//
// For each profile folder it creates (or reuses) a short_profiles row pointing at
// the creator's TikTok page (source_ref = https://www.tiktok.com/@<handle>,
// auto_poll on) so the poller keeps syncing NEW clips, then COPIES each
// <name>.web.mp4 (+ .jpg poster) into shorts/main/<slug>/ and inserts a 'ready'
// row. Clips are already web-optimized, so no transcode is needed.
//
// Dedup: source_id = the TikTok video id parsed from the sibling .md `url`. A
// clip whose (profile_id, source_id) already exists — or whose source_id is
// already known to the profile from a prior poll — is skipped, so re-running is
// safe and future polls won't re-download what we import here.

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "/app/data";
const DB_PATH = path.join(DATA_DIR, "elitev2.db");
const SHORTS_ROOT = process.env.SHORTS_ROOT || "/shorts-store";
const SRC = process.env.IMPORT_SRC || "/elite-src/shortvideos";
const CHANNEL = "main";
const DEFAULT_LIMIT = 30;

const log = (m) => console.log(`[import-shortvideos] ${m}`);

function profileSlug(name) {
  const slug = (name || "unknown")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 64);
  return slug || "unknown";
}

// Minimal frontmatter reader for the legacy .md sidecars.
function readSidecar(mdPath) {
  const out = {};
  try {
    const text = fs.readFileSync(mdPath, "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if (
        (v.startsWith("'") && v.endsWith("'")) ||
        (v.startsWith('"') && v.endsWith('"'))
      ) {
        v = v.slice(1, -1);
      }
      out[m[1]] = v;
    }
  } catch {
    /* no sidecar */
  }
  return out;
}

function tiktokVideoId(url) {
  const m = (url || "").match(/\/video\/(\d+)/);
  return m ? m[1] : null;
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 15000");

const findProfile = db.prepare(
  "SELECT id FROM short_profiles WHERE source_ref = ? OR name = ? LIMIT 1"
);
const insertProfile = db.prepare(
  `INSERT INTO short_profiles (name, channel, source_type, source_ref, auto_poll, videos_limit)
   VALUES (?, ?, 'yt-dlp', ?, 1, ?)`
);
const seenSource = db.prepare(
  "SELECT 1 FROM shorts WHERE profile_id = ? AND source_id = ? LIMIT 1"
);
const insertShort = db.prepare(
  `INSERT INTO shorts
     (channel, profile_id, uploader_id, caption, storage_key, poster_key,
      mime_type, duration, source, source_id, status)
   VALUES (?, ?, NULL, ?, ?, ?, 'video/mp4', ?, 'poll', ?, 'ready')`
);

if (!fs.existsSync(SRC)) {
  log(`source not found: ${SRC} (is /elite-src mounted?)`);
  process.exit(1);
}

const folders = fs
  .readdirSync(SRC, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== "_broken" && d.name !== ".processed")
  .map((d) => d.name);

let profilesNew = 0;
let imported = 0;
let skipped = 0;

for (const folder of folders) {
  const folderPath = path.join(SRC, folder);
  const clips = fs
    .readdirSync(folderPath)
    .filter((f) => f.toLowerCase().endsWith(".web.mp4"));
  if (clips.length === 0) continue;

  // Representative handle/source from the first clip's sidecar, else folder name.
  let handle = folder;
  for (const c of clips) {
    const meta = readSidecar(path.join(folderPath, c.replace(/\.web\.mp4$/i, ".md")));
    if (meta.uploader) {
      handle = meta.uploader;
      break;
    }
  }
  const sourceRef = `https://www.tiktok.com/@${handle}`;
  const slug = profileSlug(handle);

  let profile = findProfile.get(sourceRef, handle);
  if (!profile) {
    const r = insertProfile.run(handle, CHANNEL, sourceRef, DEFAULT_LIMIT);
    profile = { id: Number(r.lastInsertRowid) };
    profilesNew++;
    log(`profile + ${handle} (${sourceRef})`);
  }

  const destDir = path.join(SHORTS_ROOT, CHANNEL, slug);
  fs.mkdirSync(destDir, { recursive: true });

  for (const clip of clips) {
    const base = clip.replace(/\.web\.mp4$/i, "");
    const meta = readSidecar(path.join(folderPath, `${base}.md`));
    let sourceId = tiktokVideoId(meta.url);
    if (!sourceId && /^\d{6,}$/.test(base)) sourceId = base; // numeric-id filename

    // Dedup by (profile, source_id) or an already-present destination file.
    const destVideo = path.join(destDir, clip);
    if (sourceId && seenSource.get(profile.id, sourceId)) {
      skipped++;
      continue;
    }
    if (fs.existsSync(destVideo)) {
      skipped++;
      continue;
    }

    // Copy video (+ poster if present).
    fs.copyFileSync(path.join(folderPath, clip), destVideo);
    let posterKey = null;
    const srcPoster = path.join(folderPath, `${base}.jpg`);
    if (fs.existsSync(srcPoster)) {
      fs.copyFileSync(srcPoster, path.join(destDir, `${base}.jpg`));
      posterKey = `${slug}/${base}.jpg`;
    }

    const caption = (meta.title || meta.description || base).slice(0, 2000);
    const duration = meta.duration ? Number(meta.duration) || null : null;

    insertShort.run(
      CHANNEL,
      profile.id,
      caption,
      `${slug}/${clip}`,
      posterKey,
      duration,
      sourceId
    );
    imported++;
  }
  log(`${handle}: ${clips.length} clips processed`);
}

log(`done: ${profilesNew} new profiles, ${imported} clips imported, ${skipped} skipped (dupes)`);
db.close();
