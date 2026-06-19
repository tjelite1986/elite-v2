#!/usr/bin/env node
// Bulk-fetch original titles for shorts whose caption is missing or truncated
// (the "..."-clipped titles from the legacy elite import). Runs INSIDE the
// elitev2 container — spawned detached by the admin "Fetch original titles"
// button or via `docker exec`. For each resolvable clip it asks yt-dlp for the
// real title and stores it as the caption. Reports progress via the single-row
// short_title_state beacon the UI polls.
//
// Optional arg: a channel ('main' | '18plus') to limit the run to one section.
// Output: human log lines + a final `RESULT {json}` line the API route parses.

import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "/app/data";
const DB_PATH = path.join(DATA_DIR, "elitev2.db");
const YT_DLP = process.env.YT_DLP_BIN || "yt-dlp";
const CHANNEL = process.argv[2] === "main" || process.argv[2] === "18plus"
  ? process.argv[2]
  : null;
const DELAY_MS = 800; // be gentle with the source between requests

const log = (m) => console.log(`[fetch-titles] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Mirror lib/shorts-source.ts buildClipUrl() (host-anchored, https-only).
function buildClipUrl(sourceRef, sourceId) {
  if (!sourceId) return null;
  if (/^https?:\/\//i.test(sourceId)) return sourceId;
  if (!sourceRef) return null;
  let host;
  try {
    host = new URL(sourceRef).hostname.toLowerCase();
  } catch {
    return null;
  }
  const base = sourceRef.replace(/\/+$/, "");
  if (
    (host === "tiktok.com" || host.endsWith(".tiktok.com")) &&
    /\/@/.test(base) &&
    /^\d+$/.test(sourceId)
  ) {
    return `${base}/video/${sourceId}`;
  }
  if (
    (host === "youtube.com" ||
      host.endsWith(".youtube.com") ||
      host === "youtu.be") &&
    /^[\w-]{11}$/.test(sourceId)
  ) {
    return `https://www.youtube.com/watch?v=${sourceId}`;
  }
  return null;
}

function fetchTitle(url) {
  try {
    const out = execFileSync(
      YT_DLP,
      ["--no-warnings", "--skip-download", "--dump-single-json", "--", url],
      { encoding: "utf8", timeout: 45_000, maxBuffer: 32 * 1024 * 1024 }
    );
    const j = JSON.parse(out);
    // Prefer the full description; TikTok's title is truncated with "…".
    const text =
      (typeof j.description === "string" && j.description.trim()) ||
      (typeof j.title === "string" && j.title.trim()) ||
      "";
    return text || null;
  } catch {
    return null;
  }
}

function result(obj) {
  console.log(`RESULT ${JSON.stringify(obj)}`);
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 15000");

db.exec(`
  CREATE TABLE IF NOT EXISTS short_title_state (
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
  `INSERT INTO short_title_state (id, status, started_at, finished_at, processed, updated, total, message)
   VALUES (1, 'running', datetime('now'), NULL, 0, 0, ?, NULL)
   ON CONFLICT(id) DO UPDATE SET
     status='running', started_at=datetime('now'), finished_at=NULL,
     processed=0, updated=0, total=excluded.total, message=NULL`
);
const updateProgress = db.prepare(
  "UPDATE short_title_state SET processed = ?, updated = ? WHERE id = 1"
);
const setCaption = db.prepare("UPDATE shorts SET caption = ? WHERE id = ?");

async function main() {
  // Target clips with a missing or truncated caption that we can resolve to a
  // source URL (a profile with a tiktok/youtube source_ref + a source_id).
  const rows = db
    .prepare(
      `SELECT s.id, s.source_id, p.source_ref
         FROM shorts s
         JOIN short_profiles p ON p.id = s.profile_id
        WHERE s.is_deleted = 0
          AND s.source_id IS NOT NULL
          AND (s.caption IS NULL OR s.caption = '' OR s.caption LIKE '%...')
          AND (p.source_ref LIKE '%tiktok.com/@%'
               OR p.source_ref LIKE '%youtube.com%'
               OR p.source_ref LIKE '%youtu.be%')
          ${CHANNEL ? "AND s.channel = @channel" : ""}`
    )
    .all(CHANNEL ? { channel: CHANNEL } : {});

  setRunning.run(rows.length);
  log(`${rows.length} clip(s) to process${CHANNEL ? ` (channel=${CHANNEL})` : ""}`);

  let processed = 0;
  let updated = 0;
  for (const r of rows) {
    const url = buildClipUrl(r.source_ref, r.source_id);
    if (url) {
      const title = fetchTitle(url);
      if (title) {
        setCaption.run(title.slice(0, 2000), r.id);
        updated++;
      }
    }
    processed++;
    if (processed % 5 === 0 || processed === rows.length) {
      updateProgress.run(processed, updated);
      log(`…${processed}/${rows.length} (${updated} updated)`);
    }
    if (processed < rows.length) await sleep(DELAY_MS);
  }

  db.prepare(
    `UPDATE short_title_state
        SET status='done', finished_at=datetime('now'), processed=?, updated=?, message=NULL
      WHERE id = 1`
  ).run(processed, updated);
  log(`done: ${processed} processed, ${updated} updated`);
  result({ processed, updated });
}

main()
  .catch((err) => {
    db.prepare(
      `UPDATE short_title_state
          SET status='error', finished_at=datetime('now'), message=?
        WHERE id = 1`
    ).run(String(err && err.message ? err.message : err));
    log(`error: ${err && err.stack ? err.stack : err}`);
    result({ error: String(err && err.message ? err.message : err) });
    process.exitCode = 1;
  })
  .finally(() => db.close());
