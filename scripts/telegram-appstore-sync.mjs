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
  INSERT INTO telegram_files (channel, message_id, document_id, file_name, file_size, status, note)
  VALUES (@channel, @messageId, @documentId, @fileName, @fileSize, @status, @note)
  ON CONFLICT(channel, message_id) DO UPDATE SET
    status = excluded.status, note = excluded.note, document_id = excluded.document_id
`);

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

let downloaded = 0;
let exitCode = 0;

async function syncChannel(channel) {
  insSource.run(channel);
  const source = selSource.get(channel);
  if (!source.enabled) {
    log(`${channel}: disabled — skipping`);
    return;
  }

  const entity = await client.getEntity(channel);
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

    const info = documentInfo(message);
    if (info && APK_EXT.test(info.fileName) && !seenMessage.get(channel, message.id)) {
      const row = {
        channel,
        messageId: message.id,
        documentId: info.documentId,
        fileName: info.fileName,
        fileSize: info.fileSize,
        status: "skipped",
        note: null,
      };

      if (seenDocument.get(info.documentId)) {
        row.note = "duplicate document";
        recordFile.run(row);
        log(`${channel}#${message.id}: ${info.fileName} — already downloaded, skipped`);
      } else if (info.fileSize > MAX_BYTES) {
        row.note = `over size cap (${(info.fileSize / 1048576).toFixed(1)} MB)`;
        recordFile.run(row);
        log(`${channel}#${message.id}: ${info.fileName} — ${row.note}, skipped`);
      } else if (freeBytes(DROP_DIR) - info.fileSize < MIN_FREE_BYTES) {
        // Leave the cursor where it is so the file is retried once there is room.
        log(`${channel}: not enough free disk space — stopping`);
        break;
      } else {
        try {
          const name = await download(message, info);
          row.status = "downloaded";
          row.note = name;
          recordFile.run(row);
          downloaded += 1;
          log(
            `${channel}#${message.id}: ${name} (${(info.fileSize / 1048576).toFixed(1)} MB) -> import folder`
          );
        } catch (err) {
          row.status = "failed";
          row.note = err.message.slice(0, 300);
          recordFile.run(row);
          exitCode = 1;
          log(`${channel}#${message.id}: ${info.fileName} FAILED — ${err.message}`);
        }
      }
    }

    cursor = message.id;
  }

  if (cursor > source.last_message_id) updCursor.run(cursor, "ok", channel);
  else updStatus.run("ok", channel);
}

// Downloads to a hidden .part file first so the import job never sees a
// half-written APK, then renames into place (same filesystem, atomic).
async function download(message, info) {
  fs.mkdirSync(DROP_DIR, { recursive: true });
  let fileName = safeName(info.fileName);
  if (fs.existsSync(path.join(DROP_DIR, fileName))) {
    const ext = path.extname(fileName);
    fileName = `${path.basename(fileName, ext)}-tg${message.id}${ext}`;
  }
  const partPath = path.join(DROP_DIR, `.${fileName}.part`);
  const finalPath = path.join(DROP_DIR, fileName);

  try {
    await client.downloadMedia(message, { outputFile: partPath });
    const size = fs.statSync(partPath).size;
    if (size !== info.fileSize) {
      throw new Error(`size mismatch: got ${size}, expected ${info.fileSize}`);
    }
    fs.renameSync(partPath, finalPath);
    return fileName;
  } catch (err) {
    fs.rmSync(partPath, { force: true });
    throw err;
  }
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
