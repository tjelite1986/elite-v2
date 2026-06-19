import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import path from "path";
import { hashPassword } from "./password";

// Resolve the data directory (mounted as a named volume in Docker).
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, "elitev2.db");

// Reuse a single connection across hot reloads in dev.
const globalForDb = globalThis as unknown as { db?: Database.Database };

function createDb(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  seedAdmin(db);
  return db;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT
    );

    CREATE TABLE IF NOT EXISTS registration_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      note TEXT,
      email TEXT,
      sent_at TEXT,
      expires_at TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      used_by INTEGER REFERENCES users(id),
      used_at TEXT
    );

    CREATE TABLE IF NOT EXISTS invite_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      message TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      handled_at TEXT,
      handled_by INTEGER REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL REFERENCES users(id),
      recipient_id INTEGER NOT NULL REFERENCES users(id),
      body TEXT NOT NULL,
      attachment_type TEXT,
      attachment_data TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      read_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_messages_pair
      ON messages(sender_id, recipient_id, created_at);

    CREATE TABLE IF NOT EXISTS gallery_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      filename TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      width INTEGER,
      height INTEGER,
      latitude REAL,
      longitude REAL,
      location_name TEXT,
      camera TEXT,
      description TEXT,
      rotation INTEGER NOT NULL DEFAULT 0,
      media_version INTEGER NOT NULL DEFAULT 0,
      taken_at TEXT NOT NULL,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_favorite INTEGER NOT NULL DEFAULT 0,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_gallery_user_taken
      ON gallery_items(user_id, taken_at);

    CREATE TABLE IF NOT EXISTS gallery_albums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS gallery_album_items (
      album_id INTEGER NOT NULL REFERENCES gallery_albums(id) ON DELETE CASCADE,
      item_id INTEGER NOT NULL REFERENCES gallery_items(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (album_id, item_id)
    );

    -- Short-video ("shorts") feed: a standalone TikTok-style module with its own
    -- storage, separate from the gallery. channel splits the safe-for-work feed
    -- ('main') from the PIN-gated adult feed ('18plus').
    CREATE TABLE IF NOT EXISTS shorts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL DEFAULT 'main',
      -- Adult-content sorting bucket (18+ channel): straight/gay/lesbian/trans,
      -- or 'uncategorized' until an admin sorts it. The same profile can have
      -- clips in different categories.
      category TEXT NOT NULL DEFAULT 'uncategorized',
      profile_id INTEGER REFERENCES short_profiles(id) ON DELETE SET NULL,
      uploader_id INTEGER REFERENCES users(id),
      caption TEXT,
      storage_key TEXT NOT NULL,
      poster_key TEXT,
      mime_type TEXT NOT NULL DEFAULT 'video/mp4',
      width INTEGER,
      height INTEGER,
      duration REAL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'upload',
      source_id TEXT,
      status TEXT NOT NULL DEFAULT 'ready',
      is_deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_shorts_channel_created
      ON shorts(channel, is_deleted, created_at);

    CREATE TABLE IF NOT EXISTS short_likes (
      short_id INTEGER NOT NULL REFERENCES shorts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (short_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS short_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      short_id INTEGER NOT NULL REFERENCES shorts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_short_comments_short
      ON short_comments(short_id, created_at);

    -- Auto-poll source profiles. Created now, exercised in phase v1c. skipped_ids
    -- holds a JSON array of source-specific ids the poller should keep skipping.
    CREATE TABLE IF NOT EXISTS short_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'main',
      source_type TEXT NOT NULL DEFAULT 'yt-dlp',
      source_ref TEXT NOT NULL,
      auto_poll INTEGER NOT NULL DEFAULT 0,
      videos_limit INTEGER NOT NULL DEFAULT 20,
      skipped_ids TEXT NOT NULL DEFAULT '[]',
      last_polled_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- User-curated collections of shorts (TikTok calls these "Favorites").
    CREATE TABLE IF NOT EXISTS short_playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS short_playlist_items (
      playlist_id INTEGER NOT NULL REFERENCES short_playlists(id) ON DELETE CASCADE,
      short_id INTEGER NOT NULL REFERENCES shorts(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (playlist_id, short_id)
    );
  `);

  // Backfill last_seen for databases created before this column existed.
  const hasLastSeen = (
    db.prepare("PRAGMA table_info(users)").all() as { name: string }[]
  ).some((c) => c.name === "last_seen");
  if (!hasLastSeen) {
    db.exec("ALTER TABLE users ADD COLUMN last_seen TEXT");
  }

  // Backfill invite-tracking columns on registration_codes for older databases.
  const codeColumns = (
    db.prepare("PRAGMA table_info(registration_codes)").all() as { name: string }[]
  ).map((c) => c.name);
  if (!codeColumns.includes("email")) {
    db.exec("ALTER TABLE registration_codes ADD COLUMN email TEXT");
  }
  if (!codeColumns.includes("sent_at")) {
    db.exec("ALTER TABLE registration_codes ADD COLUMN sent_at TEXT");
  }
  if (!codeColumns.includes("expires_at")) {
    db.exec("ALTER TABLE registration_codes ADD COLUMN expires_at TEXT");
  }

  // Backfill attachment columns on messages for older databases.
  const messageColumns = (
    db.prepare("PRAGMA table_info(messages)").all() as { name: string }[]
  ).map((c) => c.name);
  if (!messageColumns.includes("attachment_type"))
    db.exec("ALTER TABLE messages ADD COLUMN attachment_type TEXT");
  if (!messageColumns.includes("attachment_data"))
    db.exec("ALTER TABLE messages ADD COLUMN attachment_data TEXT");

  // Backfill source_id on shorts (external id from auto-poll, for dedup) for
  // databases created before phase v1c.
  const shortColumns = (
    db.prepare("PRAGMA table_info(shorts)").all() as { name: string }[]
  ).map((c) => c.name);
  if (shortColumns.length > 0 && !shortColumns.includes("source_id")) {
    db.exec("ALTER TABLE shorts ADD COLUMN source_id TEXT");
  }
  // Backfill the 18+ category bucket for databases created before it.
  if (shortColumns.length > 0 && !shortColumns.includes("category")) {
    db.exec(
      "ALTER TABLE shorts ADD COLUMN category TEXT NOT NULL DEFAULT 'uncategorized'"
    );
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_shorts_profile_source ON shorts(profile_id, source_id)"
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_shorts_channel_category ON shorts(channel, category, is_deleted, status)"
  );

  // Backfill GPS columns on gallery_items for databases created before them.
  const galleryColumns = (
    db.prepare("PRAGMA table_info(gallery_items)").all() as { name: string }[]
  ).map((c) => c.name);
  if (galleryColumns.length > 0) {
    if (!galleryColumns.includes("latitude"))
      db.exec("ALTER TABLE gallery_items ADD COLUMN latitude REAL");
    if (!galleryColumns.includes("longitude"))
      db.exec("ALTER TABLE gallery_items ADD COLUMN longitude REAL");
    if (!galleryColumns.includes("rotation"))
      db.exec("ALTER TABLE gallery_items ADD COLUMN rotation INTEGER NOT NULL DEFAULT 0");
    if (!galleryColumns.includes("media_version"))
      db.exec("ALTER TABLE gallery_items ADD COLUMN media_version INTEGER NOT NULL DEFAULT 0");
    if (!galleryColumns.includes("location_name"))
      db.exec("ALTER TABLE gallery_items ADD COLUMN location_name TEXT");
    if (!galleryColumns.includes("camera"))
      db.exec("ALTER TABLE gallery_items ADD COLUMN camera TEXT");
    if (!galleryColumns.includes("description"))
      db.exec("ALTER TABLE gallery_items ADD COLUMN description TEXT");
  }
}

// Bootstrap an admin account from env on first run so codes can be created.
function seedAdmin(db: Database.Database) {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;

  const existing = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(email.toLowerCase());
  if (existing) return;

  db.prepare(
    "INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'admin')"
  ).run(email.toLowerCase(), hashPassword(password));
}

export const db = globalForDb.db ?? createDb();
if (process.env.NODE_ENV !== "production") globalForDb.db = db;

// --- Types ---
export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  role: "user" | "admin";
  created_at: string;
  last_seen: string | null;
}

export interface CodeRow {
  id: number;
  code: string;
  note: string | null;
  email: string | null;
  sent_at: string | null;
  expires_at: string | null;
  created_by: number | null;
  created_at: string;
  used_by: number | null;
  used_at: string | null;
}

export interface InviteRequestRow {
  id: number;
  email: string;
  message: string | null;
  status: "pending" | "approved" | "declined";
  created_at: string;
  handled_at: string | null;
  handled_by: number | null;
}

export interface MessageRow {
  id: number;
  sender_id: number;
  recipient_id: number;
  body: string;
  attachment_type: string | null;
  attachment_data: string | null;
  created_at: string;
  read_at: string | null;
}

export interface GalleryItemRow {
  id: number;
  user_id: number;
  filename: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  latitude: number | null;
  longitude: number | null;
  location_name: string | null;
  camera: string | null;
  description: string | null;
  rotation: number;
  media_version: number;
  taken_at: string;
  uploaded_at: string;
  is_favorite: number;
  is_deleted: number;
  deleted_at: string | null;
}

export interface GalleryAlbumRow {
  id: number;
  user_id: number;
  name: string;
  created_at: string;
}

export type ShortChannel = "main" | "18plus";

// Adult-content sorting buckets for the 18+ channel. 'uncategorized' is the
// default until an admin sorts a clip.
export type ShortCategory =
  | "straight"
  | "gay"
  | "lesbian"
  | "trans"
  | "uncategorized";

export interface ShortRow {
  id: number;
  channel: ShortChannel;
  category: ShortCategory;
  profile_id: number | null;
  uploader_id: number | null;
  caption: string | null;
  storage_key: string;
  poster_key: string | null;
  mime_type: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  size_bytes: number;
  source: "upload" | "poll" | "import";
  source_id: string | null;
  status: "ready" | "pending" | "failed";
  is_deleted: number;
  created_at: string;
}

export interface ShortCommentRow {
  id: number;
  short_id: number;
  user_id: number;
  body: string;
  created_at: string;
}

export interface ShortProfileRow {
  id: number;
  name: string;
  channel: ShortChannel;
  // 'manual' profiles have no poll source (source_ref empty); clips are added by
  // the import folder or upload instead of auto-polling.
  source_type: "yt-dlp" | "rss" | "manual";
  source_ref: string;
  auto_poll: number;
  videos_limit: number;
  skipped_ids: string;
  last_polled_at: string | null;
  created_at: string;
}
