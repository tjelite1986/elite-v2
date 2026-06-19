#!/usr/bin/env node
// Delete expired stories (rows + files). Runs INSIDE the elitev2 container via a
// host systemd timer (docker exec). Stories live 24h; this reclaims their disk.

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "/app/data";
const DB_PATH = path.join(DATA_DIR, "elitev2.db");
const POSTS_ROOT = process.env.POSTS_ROOT || "/posts-store";

const log = (m) => console.log(`[cleanup-stories] ${m}`);

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 15000");

const expired = db
  .prepare("SELECT id, storage_key FROM stories WHERE expires_at <= datetime('now')")
  .all();

let removed = 0;
const del = db.transaction((rows) => {
  for (const r of rows) {
    for (const key of [r.storage_key, r.storage_key.replace(/\.jpg$/i, "_t.jpg")]) {
      try {
        const p = path.join(POSTS_ROOT, key);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        /* best effort */
      }
    }
    db.prepare("DELETE FROM story_views WHERE story_id = ?").run(r.id);
    db.prepare("DELETE FROM stories WHERE id = ?").run(r.id);
    removed++;
  }
});
del(expired);

log(`done: ${removed} expired stories removed`);
db.close();
