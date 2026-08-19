#!/usr/bin/env node
// Telegram -> App Store feed. Reads the configured public channels with an
// MTProto user session and downloads every new .apk/.xapk document into the
// app-store import folder. Everything after that is the existing pipeline:
// the `appstore-import` job parses the real package/version out of the APK,
// attaches it to a matching app or parks it in the review queue.
//
// MTProto (not the Bot API) because the Bot API caps getFile at 20 MB and the
// channels post 100-200 MB APKs; a user session also reads any public channel
// without being an admin of it.
//
// Env:
//   TELEGRAM_API_ID / TELEGRAM_API_HASH   app credentials from my.telegram.org
//   TELEGRAM_SESSION                      session string from scripts/telegram-login.mjs
//   TELEGRAM_CHANNELS                     comma-separated usernames (default: eliteastore)
//   TELEGRAM_MAX_FILES_PER_RUN            downloads per run      (default 5)
//   TELEGRAM_MAX_FILE_MB                  per-file size cap      (default 400)
//   TELEGRAM_SCAN_LIMIT                   messages scanned/run   (default 100)
//   TELEGRAM_INITIAL_LIMIT                messages looked at on a channel's first sync (default 20)
//   TELEGRAM_MIN_FREE_GB                  refuse to download below this free space (default 5)
//
// Runs from the in-app Background Jobs panel (job id `telegram-appstore`).

import Database from "better-sqlite3";
import { setMaxListeners } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";

const DATA_DIR = process.env.DATA_DIR || "/app/data";
const DB_PATH = path.join(DATA_DIR, "elitev2.db");
const IMPORT_ROOT = process.env.IMPORT_ROOT || path.join(DATA_DIR, "_import");
const DROP_DIR = path.join(IMPORT_ROOT, "appstore");
const LOCK = "/tmp/elitev2-telegram-sync.lock";

const APK_EXT = /\.(apk|xapk|apks)$/i;
const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;
const session = process.env.TELEGRAM_SESSION;
const channels = (process.env.TELEGRAM_CHANNELS || "eliteastore")
  .split(",")
  .map((c) => c.trim().replace(/^https?:\/\/t\.me\//i, "").replace(/^@/, ""))
  .filter(Boolean);

const num = (env, fallback) => {
  const v = Number(process.env[env]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
const MAX_FILES = num("TELEGRAM_MAX_FILES_PER_RUN", 5);
const MAX_BYTES = num("TELEGRAM_MAX_FILE_MB", 400) * 1024 * 1024;
const SCAN_LIMIT = num("TELEGRAM_SCAN_LIMIT", 100);
const INITIAL_LIMIT = num("TELEGRAM_INITIAL_LIMIT", 20);
const MIN_FREE_BYTES = num("TELEGRAM_MIN_FREE_GB", 5) * 1024 * 1024 * 1024;

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

// One abort listener per download chunk worker trips the default cap of 10 and
// prints a bogus leak warning into the job output; a 200 MB file uses dozens.
setMaxListeners(200);

if (!apiId || !apiHash || !session) {
  log("TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_SESSION not set — nothing to do");
  process.exit(0);
}

// --- Single-run lock -------------------------------------------------------
// A 200 MB download can outlive the job interval; overlapping runs would fight
// over the same messages.
let lockFd;
try {
  lockFd = fs.openSync(LOCK, "wx");
  fs.writeSync(lockFd, String(process.pid));
} catch (err) {
  if (err.code === "EEXIST") {
    try {
      const pid = Number(fs.readFileSync(LOCK, "utf8").trim());
      process.kill(pid, 0);
      log("another sync is still running — skipping");
      process.exit(0);
    } catch {
      fs.rmSync(LOCK, { force: true });
      lockFd = fs.openSync(LOCK, "wx");
      fs.writeSync(lockFd, String(process.pid));
    }
  } else {
    throw err;
  }
}
const releaseLock = () => {
  try {
    if (lockFd !== undefined) fs.closeSync(lockFd);
  } catch {
    /* already closed */
  }
  fs.rmSync(LOCK, { force: true });
};
process.on("exit", releaseLock);

// --- DB --------------------------------------------------------------------
const db = new Database(DB_PATH);
// busy_timeout must come before any other pragma: a WAL switch on a locked DB
// throws SQLITE_BUSY immediately without it.
db.pragma("busy_timeout = 10000");
db.pragma("journal_mode = WAL");

const selSource = db.prepare("SELECT * FROM telegram_sources WHERE channel = ?");
const insSource = db.prepare(
  "INSERT OR IGNORE INTO telegram_sources (channel) VALUES (?)"
);
const updCursor = db.prepare(
  "UPDATE telegram_sources SET last_message_id = ?, last_synced_at = datetime('now'), last_status = ? WHERE channel = ?"
);
const updStatus = db.prepare(
  "UPDATE telegram_sources SET last_synced_at = datetime('now'), last_status = ? WHERE channel = ?"
);
const seenMessage = db.prepare(
  "SELECT 1 FROM telegram_files WHERE channel = ? AND message_id = ?"
);
const seenDocument = db.prepare(
  "SELECT 1 FROM telegram_files WHERE document_id = ? AND status = 'downloaded'"
);
const recordFile = db.prepare(`
  INSERT INTO telegram_files (channel, message_id, document_id, file_name, file_size, status, note, attempts)
  VALUES (@channel, @messageId, @documentId, @fileName, @fileSize, @status, @note, @attempts)
  ON CONFLICT(channel, message_id) DO UPDATE SET
    status = excluded.status, note = excluded.note,
    document_id = excluded.document_id, attempts = excluded.attempts
`);
const attemptsOf = db.prepare(
  "SELECT attempts FROM telegram_files WHERE channel = ? AND message_id = ?"
);
// The cursor moves past a failed message, so nothing but this list would ever
// pick it up again.
const failedRows = db.prepare(
  "SELECT message_id FROM telegram_files WHERE channel = ? AND status = 'failed' AND attempts < ? ORDER BY message_id LIMIT 20"
);

// --- Helpers ---------------------------------------------------------------
// The document attributes carry the real upload filename; the import pipeline
// parses name/version out of it, so it is kept as-is apart from path chars.
function documentInfo(message) {
  const doc = message?.media?.document;
  if (!doc || doc.className !== "Document") return null;
  const nameAttr = (doc.attributes || []).find(
    (a) => a.className === "DocumentAttributeFilename"
  );
  const fileName = nameAttr?.fileName;
  if (!fileName) return null;
  return {
    documentId: String(doc.id),
    fileName,
    fileSize: Number(doc.size),
    mimeType: doc.mimeType || "",
  };
}

function safeName(name) {
  // Path separators and control characters only; the rest of the upload name
  // (version, mod-site credits) is what the import parser reads.
  return name.replace(/[/\\]/g, "_").replace(/[\u0000-\u001f]/g, "").trim();
}

function freeBytes(dir) {
  try {
    const st = fs.statfsSync(dir);
    return st.bavail * st.bsize;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

// --- Sync ------------------------------------------------------------------
const client = new TelegramClient(new StringSession(session), apiId, apiHash, {
  connectionRetries: 3,
});

// Cross-run download tries per message. A transient MTProto failure (a purged
// sender slot, a dropped connection) is retried on the next run; after this
// many tries the file is left alone.
const MAX_ATTEMPTS = 3;
// Tries within one run, before the message is written off as failed.
const DOWNLOAD_TRIES = 3;

const HANDLED = "handled";
const IGNORED = "ignored";
const NO_SPACE = "nospace";

let downloaded = 0;
let exitCode = 0;

const mb = (bytes) => (bytes / 1048576).toFixed(1);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function processMessage(channel, message) {
  const info = documentInfo(message);
  if (!info || !APK_EXT.test(info.fileName)) return IGNORED;

  const row = {
    channel,
    messageId: message.id,
    documentId: info.documentId,
    fileName: info.fileName,
    fileSize: info.fileSize,
    status: "skipped",
    note: null,
    attempts: attemptsOf.get(channel, message.id)?.attempts || 0,
  };

  if (seenDocument.get(info.documentId)) {
    row.note = "duplicate document";
    recordFile.run(row);
    log(`${channel}#${message.id}: ${info.fileName} — already downloaded, skipped`);
    return HANDLED;
  }

  if (info.fileSize > MAX_BYTES) {
    row.note = `over size cap (${mb(info.fileSize)} MB)`;
    recordFile.run(row);
    log(`${channel}#${message.id}: ${info.fileName} — ${row.note}, skipped`);
    return HANDLED;
  }

  if (freeBytes(DROP_DIR) - info.fileSize < MIN_FREE_BYTES) {
    // Leave the ledger untouched so the file is picked up once there is room.
    log(`${channel}: not enough free disk space — stopping`);
    return NO_SPACE;
  }

  row.attempts += 1;
  try {
    const name = await download(message, info);
    row.status = "downloaded";
    row.note = name;
    recordFile.run(row);
    downloaded += 1;
    log(`${channel}#${message.id}: ${name} (${mb(info.fileSize)} MB) -> import folder`);
  } catch (err) {
    row.status = "failed";
    row.note = err.message.slice(0, 300);
    recordFile.run(row);
    exitCode = 1;
    log(
      `${channel}#${message.id}: ${info.fileName} FAILED ` +
        `(try ${row.attempts}/${MAX_ATTEMPTS}) — ${err.message}`
    );
  }
  return HANDLED;
}

async function syncChannel(channel) {
  insSource.run(channel);
  const source = selSource.get(channel);
  if (!source.enabled) {
    log(`${channel}: disabled — skipping`);
    return;
  }

  const entity = await client.getEntity(channel);

  // Earlier failures first: they sit behind the cursor, so the scan below will
  // never reach them again.
  const retryIds = failedRows.all(channel, MAX_ATTEMPTS).map((r) => r.message_id);
  if (retryIds.length) {
    log(`${channel}: retrying ${retryIds.length} earlier failure(s)`);
    const retries = await client.getMessages(entity, { ids: retryIds });
    for (const message of retries) {
      if (!message) continue;
      if (downloaded >= MAX_FILES) break;
      if ((await processMessage(channel, message)) === NO_SPACE) return;
    }
  }

  const firstSync = source.last_message_id === 0;

  // First sync only looks at the newest INITIAL_LIMIT posts — a channel's full
  // history is not worth backfilling. After that the cursor drives it and the
  // scan runs oldest-first so nothing is skipped when MAX_FILES cuts a run short.
  const messages = firstSync
    ? await client.getMessages(entity, { limit: INITIAL_LIMIT })
    : await client.getMessages(entity, {
        limit: SCAN_LIMIT,
        minId: source.last_message_id,
        reverse: true,
      });

  const ordered = [...messages].sort((a, b) => a.id - b.id);
  log(
    `${channel}: ${ordered.length} message(s) to consider` +
      (firstSync ? " (first sync)" : ` after id ${source.last_message_id}`)
  );

  let cursor = source.last_message_id;
  for (const message of ordered) {
    if (downloaded >= MAX_FILES) {
      log(`${channel}: run cap of ${MAX_FILES} file(s) reached — resuming next run`);
      break;
    }
    if (!seenMessage.get(channel, message.id)) {
      if ((await processMessage(channel, message)) === NO_SPACE) break;
    }
    cursor = message.id;
  }

  if (cursor > source.last_message_id) updCursor.run(cursor, "ok", channel);
  else updStatus.run("ok", channel);
}

// Downloads to a hidden .part file first so the import job never sees a
// half-written APK, then renames into place (same filesystem, atomic).
// A dropped sender slot mid-transfer is a retry signal, not a dead file.
async function download(message, info) {
  fs.mkdirSync(DROP_DIR, { recursive: true });
  let fileName = safeName(info.fileName);
  if (fs.existsSync(path.join(DROP_DIR, fileName))) {
    const ext = path.extname(fileName);
    fileName = `${path.basename(fileName, ext)}-tg${message.id}${ext}`;
  }
  const partPath = path.join(DROP_DIR, `.${fileName}.part`);
  const finalPath = path.join(DROP_DIR, fileName);

  let lastError;
  for (let attempt = 1; attempt <= DOWNLOAD_TRIES; attempt += 1) {
    try {
      await client.downloadMedia(message, { outputFile: partPath });
      const size = fs.statSync(partPath).size;
      if (size !== info.fileSize) {
        throw new Error(`size mismatch: got ${size}, expected ${info.fileSize}`);
      }
      fs.renameSync(partPath, finalPath);
      return fileName;
    } catch (err) {
      lastError = err;
      fs.rmSync(partPath, { force: true });
      if (attempt < DOWNLOAD_TRIES) {
        log(`  ${fileName}: ${err.message} — retry ${attempt + 1}/${DOWNLOAD_TRIES}`);
        await sleep(3000 * attempt);
      }
    }
  }
  throw lastError;
}

try {
  await client.connect();
  if (!(await client.isUserAuthorized())) {
    log("TELEGRAM_SESSION is not authorized — re-run scripts/telegram-login.mjs");
    exitCode = 1;
  } else {
    for (const channel of channels) {
      try {
        await syncChannel(channel);
      } catch (err) {
        exitCode = 1;
        updStatus.run(`error: ${err.message}`.slice(0, 200), channel);
        log(`${channel}: sync failed — ${err.message}`);
      }
    }
    log(`done: ${downloaded} file(s) downloaded`);
  }
} finally {
  await client.disconnect().catch(() => {});
  db.close();
  // GramJS leaves its connection timers behind, so end the process explicitly.
  process.exit(exitCode);
}
