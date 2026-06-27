#!/usr/bin/env node
// Duplicate scanner for the shorts library. Runs INSIDE the elitev2 container
// (spawned detached by the admin "Scan duplicates" button, or via `docker exec`
// from a host timer). It never deletes anything — it groups duplicates and
// marks the best-quality clip to keep, for an admin to review.
//
// Two clips count as duplicates when either:
//   - exact:      their file contents hash to the same sha256, or
//   - perceptual: their sampled-frame hashes match closely AND their durations
//                 are within a small tolerance (catches the same clip re-encoded
//                 at a different resolution/bitrate).
//
// "Best quality" within a group is decided by, in order: pixel count
// (width*height), then bitrate (bytes/second), then file size, then duration,
// then a ready (vs pending) status, then the oldest id as a stable tiebreak.
//
// Results are written to short_dupe_groups (table is rewritten each run) and
// progress is reported via the single-row short_dupe_state beacon. As a useful
// side effect, missing width/height/duration on scanned clips are backfilled.
//
// Output: human log lines + a final `RESULT {json}` line the API route parses.

import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "/app/data";
const DB_PATH = path.join(DATA_DIR, "elitev2.db");
const SHORTS_ROOT = process.env.SHORTS_ROOT || "/shorts-store";
const PROFILE_ROOT = process.env.PROFILE_ROOT || "/profile-store";
// Per-user upload keys (u_<user>/shorts|shorts18/...) resolve under PROFILE_ROOT;
// keep in sync with lib/shorts-storage.ts isUploadKey.
const isUploadKey = (key) => /^u_[^/]+\/(?:shorts18|shorts)\//.test(key);

// Perceptual matching knobs.
const FRAME_FRACTIONS = [0.2, 0.5, 0.8]; // where to sample (of duration)
const FRAME_TOL = 10; // max Hamming distance for one frame to count as a match
const MIN_FRAME_MATCHES = 2; // matching frames needed to call two clips dupes
const MAX_AVG_HAMMING = 12; // and the average distance must stay below this
const DUR_TOL = 1.5; // seconds: only compare clips of near-equal length

const log = (m) => console.log(`[scan-dupes] ${m}`);

// Per-user upload keys live under PROFILE_ROOT; creator/import clips under
// SHORTS_ROOT/<channel> (channelDir(): 18plus -> "18plus", else "main").
function videoPath(channel, storageKey) {
  if (isUploadKey(storageKey)) return path.join(PROFILE_ROOT, storageKey);
  const dir = channel === "18plus" ? "18plus" : "main";
  return path.join(SHORTS_ROOT, dir, storageKey);
}

// Chunked so a large clip never has to sit in memory all at once.
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

// One ffprobe call for dimensions + duration. Returns nulls on any failure.
function probeMeta(filePath) {
  try {
    const out = execFileSync(
      "ffprobe",
      [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height:format=duration",
        "-of", "json",
        filePath,
      ],
      { encoding: "utf8" }
    );
    const json = JSON.parse(out);
    const stream = (json.streams && json.streams[0]) || {};
    const w = Number(stream.width) || null;
    const h = Number(stream.height) || null;
    const d = parseFloat(json.format && json.format.duration);
    return { width: w, height: h, duration: isNaN(d) ? null : d };
  } catch {
    return { width: null, height: null, duration: null };
  }
}

// dHash of a single frame scaled to 9x8 grayscale: compare each pixel with its
// right-hand neighbour, 8 rows * 8 comparisons = 64 bits, as a BigInt.
function frameHash(filePath, seek) {
  let buf;
  try {
    buf = execFileSync(
      "ffmpeg",
      [
        "-v", "error", "-nostdin",
        "-ss", String(seek),
        "-i", filePath,
        "-frames:v", "1",
        "-vf", "scale=9:8,format=gray",
        "-f", "rawvideo",
        "-",
      ],
      { maxBuffer: 1 << 20 }
    );
  } catch {
    return null;
  }
  if (!buf || buf.length < 72) return null; // 9 cols * 8 rows
  let bits = 0n;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const i = row * 9 + col;
      bits <<= 1n;
      if (buf[i] < buf[i + 1]) bits |= 1n;
    }
  }
  return bits;
}

function frameSignature(filePath, duration) {
  const sig = [];
  const dur = duration && duration > 0 ? duration : 0;
  for (const frac of FRAME_FRACTIONS) {
    // Known duration -> seek by fraction; unknown -> spread over the first
    // seconds so short clips still yield distinct frames.
    const seek = dur > 0 ? (dur * frac).toFixed(2) : (frac * 8).toFixed(2);
    const h = frameHash(filePath, seek);
    if (h !== null) sig.push(h);
  }
  return sig;
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

// Do two frame signatures describe the same clip? Compare overlapping frames.
function signaturesMatch(a, b) {
  const n = Math.min(a.length, b.length);
  if (n === 0) return false;
  let matches = 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const d = hamming(a[i], b[i]);
    total += d;
    if (d <= FRAME_TOL) matches++;
  }
  return matches >= Math.min(MIN_FRAME_MATCHES, n) && total / n <= MAX_AVG_HAMMING;
}

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

// Quality comparator: higher = better. Returns clips sorted best-first.
function sortByQuality(clips) {
  return [...clips].sort((a, b) => {
    const pa = (a.width || 0) * (a.height || 0);
    const pb = (b.width || 0) * (b.height || 0);
    if (pa !== pb) return pb - pa;
    const ba = a.duration > 0 ? a.size_bytes / a.duration : 0;
    const bb = b.duration > 0 ? b.size_bytes / b.duration : 0;
    if (ba !== bb) return bb - ba;
    if (a.size_bytes !== b.size_bytes) return b.size_bytes - a.size_bytes;
    if ((a.duration || 0) !== (b.duration || 0)) return (b.duration || 0) - (a.duration || 0);
    const ra = a.status === "ready" ? 1 : 0;
    const rb = b.status === "ready" ? 1 : 0;
    if (ra !== rb) return rb - ra;
    return a.id - b.id; // stable: keep the oldest
  });
}

function result(obj) {
  console.log(`RESULT ${JSON.stringify(obj)}`);
}

// --- main ------------------------------------------------------------------
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 15000");

// The app normally creates these in lib/db.ts on startup, but this script also
// runs standalone (host timer / docker exec) before any request touches the db,
// so create them here too. Must stay in sync with the lib/db.ts definitions.
db.exec(`
  CREATE TABLE IF NOT EXISTS short_dupe_groups (
    group_key TEXT NOT NULL,
    short_id INTEGER NOT NULL REFERENCES shorts(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    match_type TEXT NOT NULL,
    quality_score REAL NOT NULL DEFAULT 0,
    is_best INTEGER NOT NULL DEFAULT 0,
    scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (group_key, short_id)
  );
  CREATE INDEX IF NOT EXISTS idx_short_dupe_short ON short_dupe_groups(short_id);
  CREATE TABLE IF NOT EXISTS short_dupe_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    status TEXT NOT NULL DEFAULT 'idle',
    started_at TEXT,
    finished_at TEXT,
    scanned INTEGER NOT NULL DEFAULT 0,
    groups INTEGER NOT NULL DEFAULT 0,
    message TEXT
  );
  -- Per-clip fingerprint cache so repeat scans skip the expensive sha256 +
  -- frame decoding for clips whose file size is unchanged. sig is a JSON array
  -- of hex frame hashes; sha is only filled when the clip's size collides with
  -- another (the only case exact-matching needs it).
  CREATE TABLE IF NOT EXISTS short_media_fp (
    short_id INTEGER PRIMARY KEY REFERENCES shorts(id) ON DELETE CASCADE,
    size_bytes INTEGER NOT NULL,
    sha TEXT,
    sig TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

db.prepare(
  `INSERT INTO short_dupe_state (id, status, started_at, finished_at, scanned, groups, message)
   VALUES (1, 'running', datetime('now'), NULL, 0, 0, NULL)
   ON CONFLICT(id) DO UPDATE SET
     status = 'running', started_at = datetime('now'), finished_at = NULL,
     scanned = 0, groups = 0, message = NULL`
).run();

const updateState = db.prepare(
  "UPDATE short_dupe_state SET scanned = ?, groups = ? WHERE id = 1"
);
const backfillMeta = db.prepare(
  "UPDATE shorts SET width = ?, height = ?, duration = ?, size_bytes = ? WHERE id = ?"
);
const fpGet = db.prepare(
  "SELECT size_bytes, sha, sig FROM short_media_fp WHERE short_id = ?"
);
const fpPut = db.prepare(
  `INSERT INTO short_media_fp (short_id, size_bytes, sha, sig, updated_at)
   VALUES (?, ?, ?, ?, datetime('now'))
   ON CONFLICT(short_id) DO UPDATE SET
     size_bytes = excluded.size_bytes, sha = excluded.sha,
     sig = excluded.sig, updated_at = excluded.updated_at`
);

const sigToJson = (sig) => JSON.stringify(sig.map((b) => b.toString(16)));
function sigFromJson(s) {
  try {
    return JSON.parse(s).map((h) => BigInt(`0x${h}`));
  } catch {
    return null;
  }
}

try {
  const rows = db
    .prepare(
      `SELECT id, channel, storage_key, width, height, duration, size_bytes, status
         FROM shorts
        WHERE is_deleted = 0`
    )
    .all();

  // Phase A — cheap pass: resolve dimensions/duration (probe only if missing),
  // stat the file for its real size, and pull any cached fingerprint. No hashing
  // or frame decoding here.
  log(`phase A: meta + size for ${rows.length} clip(s)…`);
  const clips = [];
  let scanned = 0;
  for (const r of rows) {
    const file = videoPath(r.channel, r.storage_key);
    if (!fs.existsSync(file)) continue;

    let { width, height, duration } = r;
    if (width == null || height == null || duration == null) {
      const meta = probeMeta(file);
      width = width ?? meta.width;
      height = height ?? meta.height;
      duration = duration ?? meta.duration;
    }

    let size = r.size_bytes;
    if (!size) {
      try {
        size = fs.statSync(file).size;
      } catch {
        size = 0;
      }
    }

    // Persist learned dimensions/size so the feed stops showing unknowns.
    if (
      r.width == null || r.height == null || r.duration == null || !r.size_bytes
    ) {
      backfillMeta.run(width, height, duration, size, r.id);
    }

    // Reuse cached sha/sig only if the file size is unchanged.
    const cache = fpGet.get(r.id);
    const cacheValid = cache && size > 0 && cache.size_bytes === size;
    const cachedSig =
      cacheValid && cache.sig ? sigFromJson(cache.sig) : null;

    clips.push({
      id: r.id,
      channel: r.channel,
      file,
      width,
      height,
      duration: duration || 0,
      size_bytes: size,
      status: r.status,
      sha: cacheValid ? cache.sha : null, // may be null until phase B needs it
      sig: cachedSig, // null = not computed yet
    });

    if (++scanned % 50 === 0) {
      updateState.run(scanned, 0);
      log(`…meta ${scanned}/${rows.length}`);
    }
  }
  updateState.run(scanned, 0);

  // Phase B — exact candidates: only hash clips whose size collides with another
  // (byte-identical files must share a size), so most files are never read.
  const bySize = new Map();
  for (const c of clips) {
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
  log(`phase B: hashed ${hashed} size-colliding clip(s)`);

  // Phase C — perceptual candidates: only frame-hash clips that have a
  // same-channel neighbour within DUR_TOL (the only clips perceptual matching
  // could ever pair). Reuse cached signatures.
  const needFrames = new Set();
  const byChannelDur = new Map();
  for (const c of clips) {
    if (!byChannelDur.has(c.channel)) byChannelDur.set(c.channel, []);
    byChannelDur.get(c.channel).push(c);
  }
  for (const list of byChannelDur.values()) {
    const s = [...list].sort((a, b) => a.duration - b.duration);
    for (let i = 0; i < s.length; i++) {
      for (let j = i + 1; j < s.length; j++) {
        if (s[j].duration - s[i].duration > DUR_TOL) break;
        needFrames.add(s[i].id);
        needFrames.add(s[j].id);
      }
    }
  }
  let framed = 0;
  let frameProgress = 0;
  for (const c of clips) {
    if (!needFrames.has(c.id)) continue;
    if (c.sig == null) {
      c.sig = frameSignature(c.file, c.duration);
      framed++;
      if (++frameProgress % 25 === 0) {
        log(`…frames ${frameProgress}/${needFrames.size}`);
      }
    }
  }
  log(`phase C: frame-hashed ${framed} duration-neighbour clip(s)`);

  // Refresh the fingerprint cache for next time.
  const writeCache = db.transaction(() => {
    for (const c of clips) {
      fpPut.run(c.id, c.size_bytes, c.sha, c.sig ? sigToJson(c.sig) : null);
    }
  });
  writeCache();

  // Cluster per channel: duplicates never cross the main / 18+ boundary.
  const groupRows = [];
  let groupCounter = 0;
  const byChannel = new Map();
  for (const c of clips) {
    if (!byChannel.has(c.channel)) byChannel.set(c.channel, []);
    byChannel.get(c.channel).push(c);
  }

  for (const [channel, list] of byChannel) {
    const uf = new UnionFind();

    // Exact: union everything sharing a sha256 (clips with no hash are skipped).
    const byHash = new Map();
    for (const c of list) {
      if (c.sha == null) continue;
      if (!byHash.has(c.sha)) byHash.set(c.sha, []);
      byHash.get(c.sha).push(c);
    }
    for (const same of byHash.values()) {
      for (let i = 1; i < same.length; i++) uf.union(same[0].id, same[i].id);
    }

    // Perceptual: sliding window over clips sorted by duration, so we only
    // compare clips of near-equal length (and skip those without a signature).
    const sorted = list
      .filter((c) => c.sig && c.sig.length > 0)
      .sort((a, b) => a.duration - b.duration);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (sorted[j].duration - sorted[i].duration > DUR_TOL) break;
        if (uf.find(sorted[i].id) === uf.find(sorted[j].id)) continue;
        if (signaturesMatch(sorted[i].sig, sorted[j].sig)) {
          uf.union(sorted[i].id, sorted[j].id);
        }
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
      const groupKey = `${channel}:${++groupCounter}`;
      const allSameHash =
        members[0].sha != null &&
        members.every((m) => m.sha === members[0].sha);
      const matchType = allSameHash ? "exact" : "perceptual";
      const ranked = sortByQuality(members);
      ranked.forEach((m, idx) => {
        groupRows.push({
          group_key: groupKey,
          short_id: m.id,
          channel,
          match_type: matchType,
          quality_score: (m.width || 0) * (m.height || 0),
          is_best: idx === 0 ? 1 : 0,
        });
      });
    }
  }

  const insertGroup = db.prepare(
    `INSERT INTO short_dupe_groups
       (group_key, short_id, channel, match_type, quality_score, is_best)
     VALUES (@group_key, @short_id, @channel, @match_type, @quality_score, @is_best)`
  );
  const write = db.transaction((items) => {
    db.prepare("DELETE FROM short_dupe_groups").run();
    for (const it of items) insertGroup.run(it);
  });
  write(groupRows);

  const groupCount = new Set(groupRows.map((g) => g.group_key)).size;
  db.prepare(
    `UPDATE short_dupe_state
        SET status = 'done', finished_at = datetime('now'),
            scanned = ?, groups = ?, message = NULL
      WHERE id = 1`
  ).run(scanned, groupCount);

  log(`done: ${scanned} scanned, ${groupCount} duplicate group(s)`);
  result({ scanned, groups: groupCount, duplicates: groupRows.length });
} catch (err) {
  db.prepare(
    `UPDATE short_dupe_state
        SET status = 'error', finished_at = datetime('now'), message = ?
      WHERE id = 1`
  ).run(String(err && err.message ? err.message : err));
  log(`error: ${err && err.stack ? err.stack : err}`);
  result({ error: String(err && err.message ? err.message : err) });
  db.close();
  process.exit(1);
}

db.close();
