#!/usr/bin/env node
// Nightly SQLite backup: VACUUM INTO a timestamped file in BACKUP_DIR, then
// prune old copies. VACUUM INTO snapshots committed data correctly under WAL
// (a plain file copy would miss the -wal segment) and compacts the copy.

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "/app/data";
const DB_PATH = path.join(DATA_DIR, "elitev2.db");
const BACKUP_DIR = process.env.BACKUP_DIR || "/backup";
const KEEP = Math.max(1, Number(process.env.BACKUP_KEEP || 14));

const log = (m) => console.log(`[backup-db] ${m}`);

if (!fs.existsSync(BACKUP_DIR)) {
  console.error(`[backup-db] backup dir ${BACKUP_DIR} does not exist (is the bind mount missing?)`);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const outPath = path.join(BACKUP_DIR, `elitev2-${stamp}.db`);
const tmpPath = `${outPath}.tmp`;

const db = new Database(DB_PATH, { readonly: true });
db.pragma("busy_timeout = 15000");

try {
  if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  const started = Date.now();
  // VACUUM INTO refuses to overwrite, so write to a temp name and rename.
  db.prepare("VACUUM INTO ?").run(tmpPath);
  fs.renameSync(tmpPath, outPath);
  const size = fs.statSync(outPath).size;
  log(`wrote ${path.basename(outPath)} (${(size / 1024 / 1024).toFixed(1)} MB) in ${Date.now() - started} ms`);
} finally {
  db.close();
  try {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  } catch {
    /* best effort */
  }
}

// Quick integrity check on the copy — a corrupt backup is worse than none.
const check = new Database(outPath, { readonly: true });
try {
  const res = check.pragma("integrity_check", { simple: true });
  if (res !== "ok") {
    console.error(`[backup-db] integrity_check failed on backup: ${res}`);
    process.exit(1);
  }
  log("integrity_check ok");
} finally {
  check.close();
}

const old = fs
  .readdirSync(BACKUP_DIR)
  .filter((f) => /^elitev2-\d{14}\.db$/.test(f))
  .sort()
  .slice(0, -KEEP);
for (const f of old) {
  try {
    fs.unlinkSync(path.join(BACKUP_DIR, f));
    log(`pruned ${f}`);
  } catch {
    /* best effort */
  }
}

log(`done: keeping newest ${KEEP} backups`);
