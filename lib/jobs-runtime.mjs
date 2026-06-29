// Background-job runtime: the single source of truth for the scheduled jobs the
// admin manages from the in-app "Background Jobs" panel, replacing the host
// systemd timers. Written as plain ESM so the custom server (server.mjs, no
// TypeScript) and the Next route handlers (TypeScript) share ONE instance in
// the same process — like the WebSocket registry on globalThis, but via an ESM
// singleton. It owns its own better-sqlite3 connection (WAL, same DB file) and
// is the only writer of the `job_schedules` table.
//
// Each job either runs one of the scripts/*.mjs files in a child process (the
// same thing the systemd units did via `docker exec ... node scripts/X.mjs`) or
// POSTs to a loopback admin endpoint with its shared secret.

import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = process.env.DATA_DIR || path.join(PROJECT_ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "elitev2.db");

const MIN_INTERVAL = 30; // seconds — guard against a runaway tight schedule
const OUTPUT_CAP = 16000; // chars of captured output kept per run
const RUN_TIMEOUT_MS = 60 * 60 * 1000; // kill a job process stuck for over an hour
const TICK_MS = 15000; // how often the scheduler checks for due jobs

// The registry. `defaultIntervalSeconds` is only used the first time a row is
// seeded; after that the admin's saved interval wins. Run descriptors:
//   { kind: 'script', script, env? }  -> spawn `node <script>` from PROJECT_ROOT
//   { kind: 'http', path, method?, body?, secretHeader?, secretEnv? } -> loopback POST
export const JOBS = [
  {
    id: "shorts-import-18",
    name: "Shorts import (18+)",
    description: "Sort files dropped in the 18+ shorts _import folder.",
    defaultIntervalSeconds: 300,
    run: { kind: "script", script: "scripts/import-shorts.mjs" },
  },
  {
    id: "shorts-import-main",
    name: "Shorts import (main)",
    description: "Sort files dropped in the main shorts import folder.",
    defaultIntervalSeconds: 300,
    run: { kind: "script", script: "scripts/import-shorts.mjs", env: { IMPORT_CHANNEL: "main" } },
  },
  {
    id: "shorts-poll",
    name: "Shorts auto-poll",
    description: "Poll auto-poll short profiles for new clips.",
    defaultIntervalSeconds: 1800,
    run: { kind: "script", script: "scripts/poll-shorts.mjs" },
  },
  {
    id: "shorts-transcode",
    name: "Shorts transcode",
    description: "Transcode pending shorts to web-optimized .web.mp4.",
    defaultIntervalSeconds: 600,
    run: { kind: "script", script: "scripts/transcode-shorts.mjs" },
  },
  {
    id: "shorts-dupescan",
    name: "Shorts duplicate scan",
    description: "Scan the shorts library for duplicate clips.",
    defaultIntervalSeconds: 86400,
    run: { kind: "script", script: "scripts/scan-shorts-duplicates.mjs" },
  },
  {
    id: "shorts-cleanup",
    name: "Shorts cleanup",
    description: "Remove shorts whose file is gone and prune empty playlists.",
    defaultIntervalSeconds: 3600,
    run: {
      kind: "http",
      path: "/api/shorts/maintenance?action=all",
      secretHeader: "x-import-secret",
      secretEnv: "IMPORT_CRON_SECRET",
    },
  },
  {
    id: "posts-import",
    name: "Posts import",
    description: "Sort images dropped in the posts import folder.",
    defaultIntervalSeconds: 900,
    run: { kind: "script", script: "scripts/import-posts.mjs" },
  },
  {
    id: "posts-dupescan",
    name: "Posts duplicate scan",
    description: "Scan the posts library for duplicate images.",
    defaultIntervalSeconds: 86400,
    run: { kind: "script", script: "scripts/scan-posts-duplicates.mjs" },
  },
  {
    id: "posts-cleanup",
    name: "Posts cleanup",
    description: "Remove post images whose file is gone and prune empty posts.",
    defaultIntervalSeconds: 3600,
    run: {
      kind: "http",
      path: "/api/posts/maintenance?action=all",
      secretHeader: "x-import-secret",
      secretEnv: "IMPORT_CRON_SECRET",
    },
  },
  {
    id: "gallery-dupescan",
    name: "Gallery duplicate scan",
    description: "Scan the gallery library for duplicate images.",
    defaultIntervalSeconds: 86400,
    run: { kind: "script", script: "scripts/scan-gallery-duplicates.mjs" },
  },
  {
    id: "gallery-cleanup",
    name: "Gallery cleanup",
    description: "Remove gallery items whose file is gone.",
    defaultIntervalSeconds: 3600,
    run: {
      kind: "http",
      path: "/api/gallery/maintenance?action=all",
      secretHeader: "x-import-secret",
      secretEnv: "IMPORT_CRON_SECRET",
    },
  },
  {
    id: "stories-cleanup",
    name: "Stories cleanup",
    description: "Delete expired stories (rows + files).",
    defaultIntervalSeconds: 3600,
    run: { kind: "script", script: "scripts/cleanup-stories.mjs" },
  },
  {
    id: "app-updates",
    name: "App Store update check",
    description: "Check installed store apps for new versions (no auto-download).",
    defaultIntervalSeconds: 21600,
    run: {
      kind: "http",
      path: "/api/store/admin/check-updates",
      body: { source: "all" },
      secretHeader: "x-app-update-secret",
      secretEnv: "APP_UPDATE_SECRET",
    },
  },
  {
    id: "instagram-sync",
    name: "Instagram sync",
    description:
      "Sync new media from every connected Instagram account (profiles with ig_auto_poll on).",
    defaultIntervalSeconds: 21600,
    // No handle arg -> scripts/instagram-sync.mjs syncs all ig_auto_poll profiles.
    run: { kind: "script", script: "scripts/instagram-sync.mjs" },
  },
  {
    id: "tiktok-sync",
    name: "TikTok sync",
    description:
      "Sync new media from every connected TikTok account (profiles with tt_auto_poll on).",
    defaultIntervalSeconds: 21600,
    // No handle arg -> scripts/tiktok-sync.mjs syncs all tt_auto_poll profiles.
    run: { kind: "script", script: "scripts/tiktok-sync.mjs" },
  },
];

const byId = new Map(JOBS.map((j) => [j.id, j]));

let _db = null;
function getDb() {
  if (_db) return _db;
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  // Defensive: lib/db.ts owns the canonical schema, but create it here too so
  // the runtime works even if it loads before the TS migration has run.
  db.exec(`
    CREATE TABLE IF NOT EXISTS job_schedules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 0,
      interval_seconds INTEGER NOT NULL,
      last_run_at TEXT,
      last_status TEXT,
      last_duration_ms INTEGER,
      last_output TEXT,
      next_run_at TEXT,
      running INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  _db = db;
  return db;
}

// Seed (or refresh the name/description of) one row per registry job. The
// admin's enabled/interval are preserved across restarts.
function ensureRows() {
  const db = getDb();
  const up = db.prepare(`
    INSERT INTO job_schedules (id, name, description, interval_seconds)
    VALUES (@id, @name, @description, @interval)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description
  `);
  const tx = db.transaction(() => {
    for (const j of JOBS) {
      up.run({ id: j.id, name: j.name, description: j.description, interval: j.defaultIntervalSeconds });
    }
  });
  tx();
}

function rowToJob(r) {
  return { ...r, enabled: !!r.enabled, running: !!r.running };
}

export function listJobs() {
  ensureRows();
  const db = getDb();
  const rows = db.prepare("SELECT * FROM job_schedules ORDER BY name").all();
  // Hide rows for jobs no longer in the registry.
  return rows.filter((r) => byId.has(r.id)).map(rowToJob);
}

export function setJobConfig(id, { enabled, intervalSeconds } = {}) {
  if (!byId.has(id)) return null;
  ensureRows();
  const db = getDb();
  const row = db.prepare("SELECT * FROM job_schedules WHERE id = ?").get(id);
  const nextEnabled = enabled === undefined ? row.enabled : enabled ? 1 : 0;
  let nextInterval = row.interval_seconds;
  if (intervalSeconds !== undefined && Number.isFinite(intervalSeconds)) {
    nextInterval = Math.max(MIN_INTERVAL, Math.floor(intervalSeconds));
  }
  if (nextEnabled) {
    db.prepare(
      "UPDATE job_schedules SET enabled = 1, interval_seconds = ?, next_run_at = datetime('now', ?), updated_at = datetime('now') WHERE id = ?"
    ).run(nextInterval, `+${nextInterval} seconds`, id);
  } else {
    db.prepare(
      "UPDATE job_schedules SET enabled = 0, interval_seconds = ?, next_run_at = NULL, updated_at = datetime('now') WHERE id = ?"
    ).run(nextInterval, id);
  }
  return rowToJob(db.prepare("SELECT * FROM job_schedules WHERE id = ?").get(id));
}

function runScript(rel, extraEnv) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [rel], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, ...(extraEnv || {}) },
    });
    let out = "";
    const append = (buf) => {
      out += buf.toString();
      if (out.length > OUTPUT_CAP * 2) out = out.slice(-OUTPUT_CAP * 2);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }, RUN_TIMEOUT_MS);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, output: `${out}\n${e.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, output: `${out}\n[exit ${code}]` });
    });
  });
}

async function runHttp(r) {
  const secret = r.secretEnv ? process.env[r.secretEnv] : null;
  if (r.secretEnv && !secret) {
    return { ok: false, output: `${r.secretEnv} is not set — cannot authenticate this job.` };
  }
  const base = `http://127.0.0.1:${process.env.PORT || 3000}`;
  const headers = { "Content-Type": "application/json" };
  if (secret && r.secretHeader) headers[r.secretHeader] = secret;
  try {
    const res = await fetch(base + r.path, {
      method: r.method || "POST",
      headers,
      body: JSON.stringify(r.body || {}),
    });
    const text = await res.text();
    return { ok: res.ok, output: `${res.status} ${text}`.slice(0, OUTPUT_CAP) };
  } catch (e) {
    return { ok: false, output: String((e && e.message) || e) };
  }
}

function executeJob(job) {
  const r = job.run;
  if (r.kind === "script") return runScript(r.script, r.env);
  if (r.kind === "http") return runHttp(r);
  return Promise.resolve({ ok: false, output: `unknown run kind: ${r.kind}` });
}

// Run a job once, recording the result. The `running = 0` guard in the claiming
// UPDATE makes this safe against overlap from a concurrent scheduler tick or a
// second manual trigger: only one caller wins the claim, the rest get skipped.
export async function runJobNow(id) {
  const job = byId.get(id);
  if (!job) return { ok: false, error: "unknown job" };
  ensureRows();
  const db = getDb();
  const claim = db
    .prepare(
      "UPDATE job_schedules SET running = 1, last_status = 'running', last_run_at = datetime('now') WHERE id = ? AND running = 0"
    )
    .run(id);
  if (claim.changes === 0) return { ok: false, skipped: true, error: "already running" };

  const started = Date.now();
  let result;
  try {
    result = await executeJob(job);
  } catch (e) {
    result = { ok: false, output: String((e && e.message) || e) };
  }
  const durationMs = Date.now() - started;
  const status = result.ok ? "ok" : "error";
  const output = (result.output || "").slice(-OUTPUT_CAP);
  const row = db.prepare("SELECT enabled, interval_seconds FROM job_schedules WHERE id = ?").get(id);
  if (row && row.enabled) {
    db.prepare(
      "UPDATE job_schedules SET running = 0, last_status = ?, last_duration_ms = ?, last_output = ?, next_run_at = datetime('now', ?), updated_at = datetime('now') WHERE id = ?"
    ).run(status, durationMs, output, `+${row.interval_seconds} seconds`, id);
  } else {
    db.prepare(
      "UPDATE job_schedules SET running = 0, last_status = ?, last_duration_ms = ?, last_output = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(status, durationMs, output, id);
  }
  return { ok: result.ok, durationMs, output };
}

function tick() {
  try {
    const db = getDb();
    const due = db
      .prepare(
        "SELECT id FROM job_schedules WHERE enabled = 1 AND running = 0 AND (next_run_at IS NULL OR next_run_at <= datetime('now'))"
      )
      .all();
    for (const { id } of due) {
      // Fire and forget; runJobNow atomically claims, so two ticks can't double-run.
      runJobNow(id).catch(() => {});
    }
  } catch {
    /* never let a tick crash the server */
  }
}

let _started = false;
// Start the in-process scheduler. Called once from server.mjs in production.
// In `next dev` this is never called, so jobs only run via the "Run now" button.
export function startScheduler() {
  if (_started) return;
  _started = true;
  const db = getDb();
  ensureRows();
  // Clear stale running flags left behind by a previous process that crashed
  // mid-run, so those jobs aren't wedged as permanently "running".
  db.prepare("UPDATE job_schedules SET running = 0 WHERE running = 1").run();
  const interval = setInterval(tick, TICK_MS);
  if (interval.unref) interval.unref();
  const initial = setTimeout(tick, 8000);
  if (initial.unref) initial.unref();
  console.log(`> Background-job scheduler started (${JOBS.length} jobs registered)`);
}
