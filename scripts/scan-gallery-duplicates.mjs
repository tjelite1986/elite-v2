#!/usr/bin/env node
// Duplicate scanner for the gallery (photo) library. Runs INSIDE the elitev2
// container (spawned detached by the admin "Scan duplicates" button, or via the
// in-app job scheduler). It never deletes anything — it groups duplicate images
// and marks the best-quality copy to keep, for an admin to review. Mirrors
// scripts/scan-posts-duplicates.mjs, adapted for the per-user gallery.
//
// Two images count as duplicates when either:
//   - exact:      their original files hash to the same sha256, or
//   - perceptual: their dHash fingerprints are within a small Hamming distance
//                 (catches the same photo re-cropped or re-compressed).
//
// Duplicates are scoped per OWNER (a user's own gallery) so the same photo owned
// by two different accounts is never flagged as deletable — group_key carries
// the owner's user_id.
//
// "Best quality" within a group is decided by, in order: pixel count
// (width*height), then file size, then the oldest item id as a stable tiebreak.
//
// Results are written to gallery_dupe_groups (table is rewritten each run) and
// progress is reported via the single-row gallery_dupe_state beacon.
//
// Output: human log lines + a final `RESULT {json}` line the API route parses.

import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

const DATA_DIR = process.env.DATA_DIR || "/app/data";
const DB_PATH = path.join(DATA_DIR, "elitev2.db");
// Per-user gallery originals live under PROFILE_ROOT/u_<slug>/gallery/originals/;
// the legacy central layout under GALLERY_ROOT/originals/<userId>/ is kept as a
// read-only fallback (see lib/gallery-storage.ts).
const PROFILE_ROOT = process.env.PROFILE_ROOT || path.join(DATA_DIR, "profile");
const GALLERY_ROOT = process.env.GALLERY_ROOT || path.join(DATA_DIR, "gallery");
const LEGACY_ORIGINALS_DIR = path.join(GALLERY_ROOT, "originals");

// Perceptual matching: max Hamming distance (of a 64-bit dHash) for two images
// to count as the same photo.
const HASH_TOL = 10;

const log = (m) => console.log(`[scan-gallery-dupes] ${m}`);
const result = (obj) => console.log(`RESULT ${JSON.stringify(obj)}`);

// Filesystem-safe per-user slug, identical to userGalleryRoot() in
// lib/gallery-storage.ts. Falls back to the numeric id when no username.
function userSlug(username, userId) {
  const slug = (username || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 64);
  return slug || String(userId);
}

// Resolve the original file path for one item, preferring the per-user layout
// and falling back to the legacy central path so unmigrated files still scan.
function originalPath(userId, slug, storageKey) {
  const perUser = path.join(PROFILE_ROOT, `u_${slug}`, "gallery", "originals", storageKey);
  if (fs.existsSync(perUser)) return perUser;
  const legacy = path.join(LEGACY_ORIGINALS_DIR, String(userId), storageKey);
  return fs.existsSync(legacy) ? legacy : perUser;
}

function isHeicPath(filePath) {
  const ext = (path.extname(filePath).slice(1) || "").toLowerCase();
  return ext === "heic" || ext === "heif";
}

// Convert a HEIC/HEIF file to a temp JPEG via the libheif CLI (sharp's bundled
// libvips can't decode HEIC). Returns the temp path, or null on failure.
function heicToJpegFile(filePath) {
  const tmpOut = path.join(os.tmpdir(), `${randomUUID()}.jpg`);
  try {
    execFileSync("heif-convert", ["-q", "90", filePath, tmpOut], { stdio: "ignore" });
    if (fs.existsSync(tmpOut) && fs.statSync(tmpOut).size > 0) return tmpOut;
  } catch {
    /* fall through */
  }
  try {
    if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
  } catch {
    /* best effort */
  }
  return null;
}

// Chunked sha256 so a large image never sits in memory all at once.
function sha256File(filePath) {
  const hash = createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.allocUnsafe(1 << 20); // 1 MiB
    let bytes;
    while ((bytes = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

// Perceptual fingerprint of one image: a 64-bit dHash plus a grayscale flag.
// We decode a tiny 9x8 sRGB thumbnail once, then derive both from it:
//   - dHash: per-pixel luminance, compare each pixel with its right-hand
//            neighbour (8 rows * 8 comparisons = 64 bits as a BigInt).
//   - gray:  average colour saturation; a black & white copy reads as gray so we
//            never match it against the colour original (their dHash is nearly
//            identical because dHash throws colour away).
// toColourspace('srgb') guarantees 3 channels even for grayscale-encoded files.
// HEIC originals are converted to a temp JPEG first. Returns null on any failure.
const GRAY_SAT = 14; // mean (max-min) channel spread below this = grayscale

async function imageFingerprint(filePath) {
  let decodePath = filePath;
  let tmp = null;
  if (isHeicPath(filePath)) {
    tmp = heicToJpegFile(filePath);
    if (!tmp) return null;
    decodePath = tmp;
  }
  let buf;
  try {
    buf = await sharp(decodePath)
      .resize(9, 8, { fit: "fill" })
      .toColourspace("srgb")
      .removeAlpha()
      .raw()
      .toBuffer();
  } catch {
    return null;
  } finally {
    if (tmp) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* best effort */
      }
    }
  }
  if (!buf || buf.length < 9 * 8 * 3) return null;
  const lum = new Array(72);
  let satSum = 0;
  for (let p = 0; p < 72; p++) {
    const r = buf[p * 3], g = buf[p * 3 + 1], b = buf[p * 3 + 2];
    lum[p] = 0.299 * r + 0.587 * g + 0.114 * b;
    satSum += Math.max(r, g, b) - Math.min(r, g, b);
  }
  let bits = 0n;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const i = row * 9 + col;
      bits <<= 1n;
      if (lum[i] < lum[i + 1]) bits |= 1n;
    }
  }
  return { hash: bits, gray: satSum / 72 < GRAY_SAT ? 1 : 0 };
}

function popcount(x) {
  let count = 0n;
  while (x > 0n) {
    count += x & 1n;
    x >>= 1n;
  }
  return Number(count);
}

const hamming = (a, b) => popcount(a ^ b);

// --- union-find -----------------------------------------------------------
class UnionFind {
  constructor() {
    this.parent = new Map();
  }
  find(x) {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    while (this.parent.get(x) !== root) {
      const next = this.parent.get(x);
      this.parent.set(x, root);
      x = next;
    }
    return root;
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

// Quality comparator: higher = better. Returns images sorted best-first.
function sortByQuality(items) {
  return [...items].sort((a, b) => {
    const pa = (a.width || 0) * (a.height || 0);
    const pb = (b.width || 0) * (b.height || 0);
    if (pa !== pb) return pb - pa;
    if (a.size_bytes !== b.size_bytes) return b.size_bytes - a.size_bytes;
    return a.id - b.id; // stable: keep the oldest
  });
}

// --- main ------------------------------------------------------------------
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 15000");

// The app normally creates these in lib/db.ts on startup, but this script also
// runs standalone (job scheduler / docker exec) before any request touches the
// db, so create them here too. Must stay in sync with the lib/db.ts definitions.
db.exec(`
  CREATE TABLE IF NOT EXISTS gallery_dupe_groups (
    group_key TEXT NOT NULL,
    item_id INTEGER NOT NULL REFERENCES gallery_items(id) ON DELETE CASCADE,
    match_type TEXT NOT NULL,
    quality_score REAL NOT NULL DEFAULT 0,
    is_best INTEGER NOT NULL DEFAULT 0,
    distance INTEGER NOT NULL DEFAULT 0,
    scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (group_key, item_id)
  );
  CREATE INDEX IF NOT EXISTS idx_gallery_dupe_item ON gallery_dupe_groups(item_id);
  CREATE TABLE IF NOT EXISTS gallery_dupe_ignored (
    a_item_id INTEGER NOT NULL,
    b_item_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (a_item_id, b_item_id)
  );
  CREATE TABLE IF NOT EXISTS gallery_dupe_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    status TEXT NOT NULL DEFAULT 'idle',
    started_at TEXT,
    finished_at TEXT,
    scanned INTEGER NOT NULL DEFAULT 0,
    groups INTEGER NOT NULL DEFAULT 0,
    message TEXT
  );
  CREATE TABLE IF NOT EXISTS gallery_media_fp (
    item_id INTEGER PRIMARY KEY REFERENCES gallery_items(id) ON DELETE CASCADE,
    size_bytes INTEGER NOT NULL,
    sha TEXT,
    sig TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Add the distance column to an already-created table (the app does the same on
// startup; the scanner can run first via the job scheduler).
const dupeCols = db
  .prepare("PRAGMA table_info(gallery_dupe_groups)")
  .all()
  .map((c) => c.name);
if (!dupeCols.includes("distance")) {
  db.exec("ALTER TABLE gallery_dupe_groups ADD COLUMN distance INTEGER NOT NULL DEFAULT 0");
}

db.prepare(
  `INSERT INTO gallery_dupe_state (id, status, started_at, finished_at, scanned, groups, message)
   VALUES (1, 'running', datetime('now'), NULL, 0, 0, NULL)
   ON CONFLICT(id) DO UPDATE SET
     status = 'running', started_at = datetime('now'), finished_at = NULL,
     scanned = 0, groups = 0, message = NULL`
).run();

const updateState = db.prepare(
  "UPDATE gallery_dupe_state SET scanned = ?, groups = ? WHERE id = 1"
);
const fpGet = db.prepare(
  "SELECT size_bytes, sha, sig FROM gallery_media_fp WHERE item_id = ?"
);
const fpPut = db.prepare(
  `INSERT INTO gallery_media_fp (item_id, size_bytes, sha, sig, updated_at)
   VALUES (?, ?, ?, ?, datetime('now'))
   ON CONFLICT(item_id) DO UPDATE SET
     size_bytes = excluded.size_bytes, sha = excluded.sha,
     sig = excluded.sig, updated_at = excluded.updated_at`
);

try {
  // Owner username slugs (for the per-user storage path).
  const slugByUser = new Map();
  for (const r of db.prepare("SELECT user_id, username FROM user_profiles").all()) {
    slugByUser.set(r.user_id, userSlug(r.username, r.user_id));
  }

  // Images only — videos are not de-duplicated here.
  const rows = db
    .prepare(
      `SELECT gi.id AS item_id, gi.user_id, gi.storage_key, gi.width, gi.height
         FROM gallery_items gi
        WHERE gi.is_deleted = 0
          AND gi.mime_type LIKE 'image/%'`
    )
    .all();

  // Phase A — cheap pass: stat the file for its size and pull any cached
  // fingerprint. No hashing or image decoding here.
  log(`phase A: size + cache for ${rows.length} image(s)…`);
  const items = [];
  let scanned = 0;
  for (const r of rows) {
    const slug = slugByUser.get(r.user_id) || String(r.user_id);
    const file = originalPath(r.user_id, slug, r.storage_key);
    if (!fs.existsSync(file)) continue;

    let size;
    try {
      size = fs.statSync(file).size;
    } catch {
      size = 0;
    }

    // The gallery is per user, so duplicates are scoped per owner.
    const authorKey = `u:${r.user_id}`;

    const cache = fpGet.get(r.item_id);
    const cacheValid = cache && size > 0 && cache.size_bytes === size;
    // sig is JSON {"d":"<hex dHash>","g":0|1 grayscale}. Old hex-only caches
    // fail the parse and are simply recomputed.
    let fp = null;
    if (cacheValid && cache.sig) {
      try {
        const parsed = JSON.parse(cache.sig);
        if (parsed && parsed.d) fp = { hash: BigInt(`0x${parsed.d}`), gray: parsed.g ? 1 : 0 };
      } catch {
        fp = null;
      }
    }

    items.push({
      id: r.item_id,
      user_id: r.user_id,
      authorKey,
      file,
      width: r.width,
      height: r.height,
      size_bytes: size,
      sha: cacheValid ? cache.sha : null,
      fp, // { hash, gray } or null = not computed yet
    });

    if (++scanned % 100 === 0) {
      updateState.run(scanned, 0);
      log(`…meta ${scanned}/${rows.length}`);
    }
  }
  updateState.run(scanned, 0);

  // Only owners with at least two images can have duplicates — restrict all
  // expensive work to them.
  const authorCount = new Map();
  for (const it of items) authorCount.set(it.authorKey, (authorCount.get(it.authorKey) || 0) + 1);
  const candidates = items.filter((it) => authorCount.get(it.authorKey) > 1);

  // Phase B — exact candidates: only hash images whose size collides with
  // another (byte-identical files share a size) and that don't already have a
  // cached sha. Most files are never read.
  const bySize = new Map();
  for (const c of candidates) {
    if (c.size_bytes > 0) {
      if (!bySize.has(c.size_bytes)) bySize.set(c.size_bytes, []);
      bySize.get(c.size_bytes).push(c);
    }
  }
  let hashed = 0;
  for (const list of bySize.values()) {
    if (list.length < 2) continue;
    for (const c of list) {
      if (c.sha == null) {
        c.sha = sha256File(c.file);
        hashed++;
      }
    }
  }
  log(`phase B: hashed ${hashed} size-colliding image(s)`);

  // Phase C — perceptual: compute a fingerprint for every candidate that lacks a
  // cached one. Images are cheap (one small decode each).
  let framed = 0;
  let frameProgress = 0;
  for (const c of candidates) {
    if (c.fp === null) {
      c.fp = await imageFingerprint(c.file);
      framed++;
      if (++frameProgress % 100 === 0) {
        log(`…hashed ${frameProgress}/${candidates.length}`);
      }
    }
  }
  log(`phase C: perceptual-hashed ${framed} image(s)`);

  // Refresh the fingerprint cache for next time (all images, so removed owners
  // keep a stable size baseline).
  const writeCache = db.transaction(() => {
    for (const c of items) {
      const sig = c.fp
        ? JSON.stringify({ d: c.fp.hash.toString(16), g: c.fp.gray })
        : null;
      fpPut.run(c.id, c.size_bytes, c.sha, sig);
    }
  });
  writeCache();

  // Pairs an admin marked "not duplicates" — the perceptual matcher must not
  // re-group them. Keyed "a:b" with a<b.
  const ignored = new Set();
  for (const row of db.prepare("SELECT a_item_id, b_item_id FROM gallery_dupe_ignored").all()) {
    ignored.add(`${row.a_item_id}:${row.b_item_id}`);
  }
  const isIgnored = (x, y) => {
    const a = Math.min(x, y), b = Math.max(x, y);
    return ignored.has(`${a}:${b}`);
  };

  // Cluster per owner: duplicates never cross owners.
  const groupRows = [];
  let groupCounter = 0;
  const byAuthor = new Map();
  for (const c of candidates) {
    if (!byAuthor.has(c.authorKey)) byAuthor.set(c.authorKey, []);
    byAuthor.get(c.authorKey).push(c);
  }

  for (const [, list] of byAuthor) {
    const ownerId = list[0].user_id;
    const uf = new UnionFind();

    // Exact: union everything sharing a sha256 (images with no hash are skipped).
    // Byte-identical files are never ignored — they are genuinely the same file.
    const byHash = new Map();
    for (const c of list) {
      if (c.sha == null) continue;
      if (!byHash.has(c.sha)) byHash.set(c.sha, []);
      byHash.get(c.sha).push(c);
    }
    for (const same of byHash.values()) {
      for (let i = 1; i < same.length; i++) uf.union(same[0].id, same[i].id);
    }

    // Perceptual: pairwise within the owner (small sets). Union when the dHash
    // is within tolerance AND both images are colour or both grayscale (so a B&W
    // copy never matches its colour original) AND the pair isn't admin-ignored.
    const withFp = list.filter((c) => c.fp != null);
    for (let i = 0; i < withFp.length; i++) {
      for (let j = i + 1; j < withFp.length; j++) {
        const a = withFp[i], b = withFp[j];
        if (uf.find(a.id) === uf.find(b.id)) continue;
        if (a.fp.gray !== b.fp.gray) continue;
        if (isIgnored(a.id, b.id)) continue;
        if (hamming(a.fp.hash, b.fp.hash) <= HASH_TOL) uf.union(a.id, b.id);
      }
    }

    // Collect components with more than one member.
    const components = new Map();
    for (const c of list) {
      const root = uf.find(c.id);
      if (!components.has(root)) components.set(root, []);
      components.get(root).push(c);
    }

    for (const members of components.values()) {
      if (members.length < 2) continue;
      // group_key carries the owner so two users' groups never collide.
      const groupKey = `u:${ownerId}:g:${++groupCounter}`;
      const allSameHash =
        members[0].sha != null &&
        members.every((m) => m.sha === members[0].sha);
      const matchType = allSameHash ? "exact" : "perceptual";
      const ranked = sortByQuality(members);
      const best = ranked[0];
      ranked.forEach((m, idx) => {
        // How far this copy is from the kept image, surfaced as a similarity %.
        const distance =
          idx === 0 || !m.fp || !best.fp ? 0 : hamming(m.fp.hash, best.fp.hash);
        groupRows.push({
          group_key: groupKey,
          item_id: m.id,
          match_type: matchType,
          quality_score: (m.width || 0) * (m.height || 0),
          is_best: idx === 0 ? 1 : 0,
          distance,
        });
      });
    }
  }

  const insertGroup = db.prepare(
    `INSERT INTO gallery_dupe_groups
       (group_key, item_id, match_type, quality_score, is_best, distance)
     VALUES (@group_key, @item_id, @match_type, @quality_score, @is_best, @distance)`
  );
  const write = db.transaction((rowsToWrite) => {
    db.prepare("DELETE FROM gallery_dupe_groups").run();
    for (const it of rowsToWrite) insertGroup.run(it);
  });
  write(groupRows);

  const groupCount = new Set(groupRows.map((g) => g.group_key)).size;
  db.prepare(
    `UPDATE gallery_dupe_state
        SET status = 'done', finished_at = datetime('now'),
            scanned = ?, groups = ?, message = NULL
      WHERE id = 1`
  ).run(scanned, groupCount);

  log(`done: ${scanned} scanned, ${groupCount} duplicate group(s)`);
  result({ scanned, groups: groupCount, duplicates: groupRows.length });
} catch (err) {
  db.prepare(
    `UPDATE gallery_dupe_state
        SET status = 'error', finished_at = datetime('now'), message = ?
      WHERE id = 1`
  ).run(String(err && err.message ? err.message : err));
  log(`error: ${err && err.stack ? err.stack : err}`);
  result({ error: String(err && err.message ? err.message : err) });
  db.close();
  process.exit(1);
}

db.close();
