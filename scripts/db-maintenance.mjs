#!/usr/bin/env node
// Periodic SQLite maintenance: force a WAL checkpoint so the -wal file cannot
// grow without bound (long-running readers keep deferring the automatic
// checkpoint), then let the query planner refresh its statistics.

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "/app/data";
const DB_PATH = path.join(DATA_DIR, "elitev2.db");
const WAL_PATH = `${DB_PATH}-wal`;
// Above this the checkpoint is clearly not keeping up — surface it in the job
// output so the admin panel shows the warning.
const WAL_WARN_BYTES = 64 * 1024 * 1024;

const log = (m) => console.log(`[db-maintenance] ${m}`);
const walSize = () => {
  try {
    return fs.statSync(WAL_PATH).size;
  } catch {
    return 0;
  }
};

const before = walSize();
const db = new Database(DB_PATH);
db.pragma("busy_timeout = 15000");

try {
  // TRUNCATE both moves all WAL frames into the main file and resets the WAL
  // to zero bytes. busy=1 means an active reader blocked full completion —
  // fine, the next run picks it up.
  const res = db.pragma("wal_checkpoint(TRUNCATE)", { simple: false })[0];
  const after = walSize();
  log(
    `wal_checkpoint(TRUNCATE): busy=${res.busy} log=${res.log} checkpointed=${res.checkpointed}, ` +
      `wal ${(before / 1024 / 1024).toFixed(1)} MB -> ${(after / 1024 / 1024).toFixed(1)} MB`
  );
  if (after > WAL_WARN_BYTES) {
    console.warn(
      `[db-maintenance] WARNING: WAL still ${(after / 1024 / 1024).toFixed(0)} MB after checkpoint — a long-running reader is pinning it`
    );
  }
  // Refresh planner statistics; SQLite only does real work when needed.
  db.pragma("optimize");
  log("optimize done");
} finally {
  db.close();
}
