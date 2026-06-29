#!/usr/bin/env node
// Import-folder auto-sorter for the 18+ shorts section. Runs INSIDE the elitev2
// container (via the admin "Import now" button or a host systemd timer using
// `docker exec`).
//
// Drop files into  <SHORTS_ROOT>/18plus/_import/  named like:
//     <profile>_-_<title>.mp4
// Everything before `_-_` (or ` - `) is the profile name. For each video the
// script:
//   1. resolves the profile name (rules below, first match wins),
//   2. finds or creates a `manual` short_profiles row on the 18+ channel,
//   3. moves the file (+ .jpg/.md sidecars) into <SHORTS_ROOT>/18plus/<slug>/,
//   4. inserts a `uncategorized` short row. Plain originals come in as 'pending'
//      so the host transcoder turns them into .web.mp4; files already named
//      *.web.mp4 are inserted 'ready' (the transcoder skips those).
// The same profile can therefore own clips across several categories — sorting
// into Straight/Gay/Lesbian/Trans happens later in the app, per clip.
//
// Profile-name rules (mirror deploy/bin/elite-organize-shorts18.py in old elite):
//   1. <profile>_-_<title>  (also `<profile> - <title>`)
//   2. <tags>_by_<profile>___RedGIFs(_<n>)?
//   3. anything ending in FikFap(_<n>)?            -> bucket "fikfap"
//   4. RDT_<digits>_<digits>                       -> bucket "rdt"
//   5. everything else                             -> bucket "misc"
//
// Output: human log lines + a final `RESULT {json}` line the API route parses.

import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "/app/data";
const DB_PATH = path.join(DATA_DIR, "elitev2.db");
const SHORTS_ROOT = process.env.SHORTS_ROOT || "/shorts-store";
const CHANNEL = process.env.IMPORT_CHANNEL || "18plus";
// Own env var (NOT the gallery's IMPORT_DIR, which is set in compose).
const IMPORT_DIR =
  process.env.SHORTS_IMPORT_DIR || path.join(SHORTS_ROOT, CHANNEL, "_import");

const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov", ".m4v"]);
const SIDECAR_EXTS = new Set([".md", ".jpg", ".jpeg", ".png", ".webp"]);
const PROFILE_RE = /^[A-Za-z0-9 ._\-()]+$/;
const DASH_PROFILE_RE = /^(\S.+?)(?:_-_|\s-\s)/;
const REDGIFS_RE = /^.+?_by_(.+?)___RedGIFs(?:_\d+)?$/;
const FIKFAP_RE = /FikFap(?:_\d+)?$/;
const RDT_RE = /^RDT_\d+_\d+$/;

const log = (m) => console.log(`[import-shorts] ${m}`);

// Shared handle (matches handleOf in lib/directory.ts) — used to reuse an
// existing profile regardless of capitalization instead of creating a variant.
function handleOf(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, "")
    .replace(/^[._]+|[._]+$/g, "");
}

// Match lib/shorts-storage.ts profileSlug() exactly so a profile maps to one dir.
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

// Bracket grammar shared with the per-user importer (lib/import-naming.ts):
//   <title> [h_<tag>]... [f_<profile>] [id_<dbid>]
// [f_] names the creator PROFILE, [h_] are hashtags, and the title is the text
// before the first "[". Takes precedence over the legacy "<profile>_-_<title>".
function parseBrackets(stem) {
  const firstBracket = stem.indexOf("[");
  const hasBrackets = firstBracket !== -1;
  const title = (hasBrackets ? stem.slice(0, firstBracket) : stem)
    .replace(/_/g, " ")
    .trim();
  let folder = null;
  const hashtags = [];
  const re = /\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(stem)) !== null) {
    const tok = m[1].trim();
    if (!tok) continue;
    if (tok.startsWith("h_")) hashtags.push(tok.slice(2));
    else if (tok.startsWith("f_")) {
      const f = tok.slice(2).trim();
      if (f) folder = f;
    }
    // [id_] is ignored here (the shared importer assigns its own ids).
  }
  return { hasBrackets, title, folder, hashtags };
}

function parseProfile(stem) {
  const b = parseBrackets(stem);
  if (b.folder) return b.folder;
  let m = stem.match(DASH_PROFILE_RE);
  if (m) {
    const p = m[1].trim();
    if (p && PROFILE_RE.test(p) && !p.includes("..")) return p;
  }
  m = stem.match(REDGIFS_RE);
  if (m && PROFILE_RE.test(m[1]) && !m[1].includes("..")) return m[1];
  if (FIKFAP_RE.test(stem)) return "fikfap";
  if (RDT_RE.test(stem)) return "rdt";
  return "misc";
}

// Title for the caption: the part after the _-_ / ` - ` separator, else the stem.
function parseTitle(stem) {
  const b = parseBrackets(stem);
  if (b.hasBrackets) return b.title;
  const idx = stem.indexOf("_-_");
  if (idx >= 0) return stem.slice(idx + 3).replace(/_/g, " ").trim();
  const sp = stem.indexOf(" - ");
  if (sp >= 0) return stem.slice(sp + 3).trim();
  return stem.replace(/_/g, " ").trim();
}

// Caption for a dropped file: the title plus any [h_] hashtags appended as
// #tags, so shorts (which store hashtags inside the caption) keep them.
function captionFromStem(stem) {
  const b = parseBrackets(stem);
  const title = b.hasBrackets ? b.title : parseTitle(stem);
  const tags = b.hashtags.map((t) => `#${t}`).join(" ");
  return [title, tags].filter(Boolean).join(" ").trim() || null;
}

function sanitizeStem(stem) {
  const cleaned = stem
    .replace(/[^A-Za-z0-9 ._\-()]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_ .]+|[_ .]+$/g, "");
  return cleaned || "clip";
}

// Extract a poster frame (~25% in) so imported clips get a thumbnail right away
// instead of waiting for the transcoder's backfill. Best-effort.
function makePoster(videoPath, posterPath) {
  let pct = "0.5";
  try {
    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", videoPath],
      { encoding: "utf8" }
    );
    const dur = parseFloat(out.trim());
    if (dur > 0) pct = (dur * 0.25).toFixed(2);
  } catch {
    /* keep default seek */
  }
  // Some files yield no frame when seeking deep in (broken index / sparse
  // keyframes), so fall back to early seeks and finally the first frame.
  for (const seek of [pct, "1", "0"]) {
    try {
      execFileSync(
        "ffmpeg",
        ["-y", "-hide_banner", "-loglevel", "error", "-nostdin",
         "-ss", seek, "-i", videoPath, "-vframes", "1",
         "-vf", "scale='min(720,iw)':-2", "-q:v", "5", posterPath],
        { stdio: "ignore" }
      );
    } catch {
      /* try the next seek */
    }
    if (fs.existsSync(posterPath) && fs.statSync(posterPath).size > 0) return;
  }
}

function mimeFor(ext) {
  switch (ext.toLowerCase()) {
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    case ".m4v":
      return "video/x-m4v";
    default:
      return "video/mp4";
  }
}

function result(obj) {
  console.log(`RESULT ${JSON.stringify(obj)}`);
}

if (!fs.existsSync(IMPORT_DIR)) {
  fs.mkdirSync(IMPORT_DIR, { recursive: true });
  log(`created import dir: ${IMPORT_DIR}`);
  result({ imported: 0, profilesNew: 0, skipped: 0 });
  process.exit(0);
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 15000");

// Existing profiles in this channel keyed by handle, so a dropped file reuses
// the same person's profile even if the filename's capitalization differs.
const profilesByHandle = new Map();
for (const p of db
  .prepare("SELECT id, name FROM short_profiles WHERE channel = ?")
  .all(CHANNEL)) {
  const h = handleOf(p.name);
  if (h && !profilesByHandle.has(h)) profilesByHandle.set(h, p);
}
const insertProfile = db.prepare(
  `INSERT INTO short_profiles (name, channel, source_type, source_ref, auto_poll, videos_limit)
   VALUES (?, ?, 'manual', '', 0, 20)`
);
const seenSource = db.prepare(
  "SELECT 1 FROM shorts WHERE profile_id = ? AND source_id = ? LIMIT 1"
);
const insertShort = db.prepare(
  `INSERT INTO shorts
     (channel, category, profile_id, uploader_id, caption, storage_key, poster_key,
      mime_type, source, source_id, status)
   VALUES (?, 'uncategorized', ?, NULL, ?, ?, ?, ?, 'import', ?, ?)`
);

const entries = fs
  .readdirSync(IMPORT_DIR, { withFileTypes: true })
  .filter((e) => e.isFile());

let imported = 0;
let profilesNew = 0;
let skipped = 0;

for (const entry of entries) {
  const [stem, ext] = splitExt(entry.name);
  if (!VIDEO_EXTS.has(ext) && ext !== ".web.mp4") continue;

  const profileName = sanitizeStem(parseProfile(stem));
  const handle = handleOf(profileName);

  // Reuse an existing same-handle profile (any capitalization) or create one.
  let profile = profilesByHandle.get(handle);
  if (!profile) {
    const r = insertProfile.run(profileName, CHANNEL);
    profile = { id: Number(r.lastInsertRowid), name: profileName };
    if (handle) profilesByHandle.set(handle, profile);
    profilesNew++;
    log(`profile + ${profileName}`);
  }
  // Files go to the resolved profile's folder, not the incoming name's.
  const slug = profileSlug(profile.name);

  const safeStem = sanitizeStem(stem);
  const sourceId = safeStem; // dedup key for re-runs
  if (seenSource.get(profile.id, sourceId)) {
    skipped++;
    continue;
  }

  const destDir = path.join(SHORTS_ROOT, CHANNEL, slug);
  fs.mkdirSync(destDir, { recursive: true });

  const destVideoName = `${safeStem}${ext}`;
  const destVideo = path.join(destDir, destVideoName);
  if (fs.existsSync(destVideo)) {
    skipped++;
    continue;
  }

  try {
    fs.renameSync(path.join(IMPORT_DIR, entry.name), destVideo);
  } catch (err) {
    log(`skip ${entry.name}: ${err.message}`);
    skipped++;
    continue;
  }

  // Move a matching poster/sidecars next to the video. A .md sidecar holds the
  // caption (e.g. an Instagram post's text routed here from import-posts).
  let posterKey = null;
  let caption = null;
  for (const scExt of SIDECAR_EXTS) {
    const sc = path.join(IMPORT_DIR, `${stem}${scExt}`);
    if (fs.existsSync(sc)) {
      if (scExt === ".md") {
        try { caption = fs.readFileSync(sc, "utf8").trim() || null; } catch { /* best effort */ }
      }
      const dest = path.join(destDir, `${safeStem}${scExt}`);
      try {
        fs.renameSync(sc, dest);
        if (!posterKey && [".jpg", ".jpeg", ".png", ".webp"].includes(scExt)) {
          posterKey = `${slug}/${safeStem}${scExt}`;
        }
      } catch {
        /* best effort */
      }
    }
  }

  // No sidecar poster: generate one now so the thumbnail shows immediately.
  if (!posterKey) {
    const pk = `${safeStem}.jpg`;
    try {
      makePoster(destVideo, path.join(destDir, pk));
      if (fs.existsSync(path.join(destDir, pk))) posterKey = `${slug}/${pk}`;
    } catch {
      /* best effort — transcoder will backfill */
    }
  }

  // *.web.mp4 is already web-optimized → ready immediately (transcoder skips it).
  // Anything else comes in pending for the transcoder to convert + poster.
  const status = ext === ".web.mp4" ? "ready" : "pending";

  insertShort.run(
    CHANNEL,
    profile.id,
    (caption || captionFromStem(stem) || "").slice(0, 2000) || null,
    `${slug}/${destVideoName}`,
    posterKey,
    mimeFor(ext),
    sourceId,
    status
  );
  imported++;
}

log(
  `done: ${imported} imported, ${profilesNew} new profiles, ${skipped} skipped`
);
result({ imported, profilesNew, skipped });
db.close();
