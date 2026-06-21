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

    -- Duplicate-scan results. scripts/scan-shorts-duplicates.mjs groups clips
    -- that are byte-identical (same sha256) or perceptually identical (matching
    -- sampled-frame hashes + similar duration), then marks the highest-quality
    -- member to keep. Reported for admin review — nothing is deleted
    -- automatically. The whole table is rewritten on each scan; one row per
    -- short that belongs to a group, tied together by group_key.
    CREATE TABLE IF NOT EXISTS short_dupe_groups (
      group_key TEXT NOT NULL,
      short_id INTEGER NOT NULL REFERENCES shorts(id) ON DELETE CASCADE,
      channel TEXT NOT NULL,
      match_type TEXT NOT NULL,            -- 'exact' | 'perceptual'
      quality_score REAL NOT NULL DEFAULT 0,
      is_best INTEGER NOT NULL DEFAULT 0,  -- the clip to keep; others are dupes
      scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (group_key, short_id)
    );

    CREATE INDEX IF NOT EXISTS idx_short_dupe_short
      ON short_dupe_groups(short_id);

    -- Single-row progress beacon for the duplicate scan, so the admin UI can
    -- poll while the detached scan runs.
    CREATE TABLE IF NOT EXISTS short_dupe_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL DEFAULT 'idle',  -- 'idle' | 'running' | 'done' | 'error'
      started_at TEXT,
      finished_at TEXT,
      scanned INTEGER NOT NULL DEFAULT 0,
      groups INTEGER NOT NULL DEFAULT 0,
      message TEXT
    );

    -- Per-clip fingerprint cache (sha256 + JSON array of frame hashes) so repeat
    -- scans skip hashing/decoding clips whose file size is unchanged. Written by
    -- scripts/scan-shorts-duplicates.mjs.
    CREATE TABLE IF NOT EXISTS short_media_fp (
      short_id INTEGER PRIMARY KEY REFERENCES shorts(id) ON DELETE CASCADE,
      size_bytes INTEGER NOT NULL,
      sha TEXT,
      sig TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Single-row progress beacon for the bulk "fetch original titles" job, so
    -- the admin UI can poll while scripts/fetch-shorts-titles.mjs runs detached.
    CREATE TABLE IF NOT EXISTS short_title_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL DEFAULT 'idle',  -- 'idle' | 'running' | 'done' | 'error'
      started_at TEXT,
      finished_at TEXT,
      processed INTEGER NOT NULL DEFAULT 0,
      updated INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      message TEXT
    );

    -- Instagram-style social photo feed ("posts"). Shares the one users table;
    -- a post is authored either by a real user OR a mirrored creator, never both.

    -- Shared public profile layer (1:1 with users). Other modules can attribute
    -- by a real handle/avatar instead of splitting the email.
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      username TEXT NOT NULL UNIQUE,
      display_name TEXT,
      avatar_key TEXT,
      bio TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Mirrored creators imported from the on-disk instagram library. NOT user
    -- accounts (same distinction as short_profiles).
    CREATE TABLE IF NOT EXISTS post_creators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT,
      avatar_key TEXT,
      bio TEXT,
      source TEXT NOT NULL DEFAULT 'import',
      is_adult INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_user_id INTEGER REFERENCES users(id),
      author_creator_id INTEGER REFERENCES post_creators(id),
      caption TEXT,
      is_adult INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_deleted INTEGER NOT NULL DEFAULT 0,
      CHECK ((author_user_id IS NULL) <> (author_creator_id IS NULL))
    );
    CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(is_deleted, created_at);
    CREATE INDEX IF NOT EXISTS idx_posts_author_user ON posts(author_user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_posts_author_creator ON posts(author_creator_id, created_at);

    -- Carousel images for a post, ordered by position. media_version busts the
    -- by-id media URL cache after a re-crop (the gallery ?v= pattern).
    CREATE TABLE IF NOT EXISTS post_media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      storage_key TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      position INTEGER NOT NULL DEFAULT 0,
      media_version INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_post_media_post ON post_media(post_id, position);

    -- Duplicate-image grouping for the posts library, mirroring short_dupe_groups.
    -- Written by scripts/scan-posts-duplicates.mjs for admin review under the
    -- posts Settings page; the scan deletes nothing. One row per image that
    -- belongs to a group, tied together by group_key. The whole table is
    -- rewritten on each scan. Duplicates are scoped per author (a creator's or a
    -- user's own images) so the same photo posted by two different authors is not
    -- flagged as deletable.
    CREATE TABLE IF NOT EXISTS post_dupe_groups (
      group_key TEXT NOT NULL,
      media_id INTEGER NOT NULL REFERENCES post_media(id) ON DELETE CASCADE,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      match_type TEXT NOT NULL,            -- 'exact' | 'perceptual'
      quality_score REAL NOT NULL DEFAULT 0,
      is_best INTEGER NOT NULL DEFAULT 0,  -- the suggested image to keep
      distance INTEGER NOT NULL DEFAULT 0, -- dHash Hamming to the best (0 = exact)
      scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (group_key, media_id)
    );
    CREATE INDEX IF NOT EXISTS idx_post_dupe_media ON post_dupe_groups(media_id);

    -- Pairs of images an admin marked "not duplicates" so the perceptual matcher
    -- stops grouping them on future scans (a<b by media id). Exact byte-identical
    -- matches are never ignored — only the fuzzy perceptual ones.
    CREATE TABLE IF NOT EXISTS post_dupe_ignored (
      a_media_id INTEGER NOT NULL,
      b_media_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (a_media_id, b_media_id)
    );

    -- Single-row progress beacon for the posts duplicate scan, so the admin UI
    -- can poll while the detached scan runs.
    CREATE TABLE IF NOT EXISTS post_dupe_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL DEFAULT 'idle',  -- 'idle' | 'running' | 'done' | 'error'
      started_at TEXT,
      finished_at TEXT,
      scanned INTEGER NOT NULL DEFAULT 0,
      groups INTEGER NOT NULL DEFAULT 0,
      message TEXT
    );

    -- Per-image fingerprint cache (sha256 + perceptual dHash) so repeat scans
    -- skip hashing/decoding images whose file size is unchanged. Written by
    -- scripts/scan-posts-duplicates.mjs.
    CREATE TABLE IF NOT EXISTS post_media_fp (
      media_id INTEGER PRIMARY KEY REFERENCES post_media(id) ON DELETE CASCADE,
      size_bytes INTEGER NOT NULL,
      sha TEXT,
      sig TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS post_likes (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (post_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS post_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_post_comments_post ON post_comments(post_id, created_at);

    -- Polymorphic social graph: a user follows either another user or a creator.
    CREATE TABLE IF NOT EXISTS follows (
      follower_id INTEGER NOT NULL REFERENCES users(id),
      target_type TEXT NOT NULL CHECK (target_type IN ('user','creator','shorts')),
      target_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (follower_id, target_type, target_id)
    );
    CREATE INDEX IF NOT EXISTS idx_follows_target ON follows(target_type, target_id);

    -- Ephemeral 24h stories (users only in v1).
    CREATE TABLE IF NOT EXISTS stories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_user_id INTEGER NOT NULL REFERENCES users(id),
      storage_key TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      media_version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stories_expires ON stories(expires_at);

    CREATE TABLE IF NOT EXISTS story_views (
      story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (story_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),       -- recipient
      type TEXT NOT NULL,                                  -- like|comment|follow|mention
      actor_user_id INTEGER NOT NULL REFERENCES users(id),
      post_id INTEGER,
      comment_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      read_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at, created_at);

    CREATE TABLE IF NOT EXISTS post_hashtags (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      PRIMARY KEY (post_id, tag)
    );

    -- Avatar chosen for a person, keyed by their shared handle so it works for
    -- every identity type (user / photo creator / video-only creator). Takes
    -- precedence over the legacy avatar_key columns. Set from a post image or a
    -- shorts/18+ clip poster.
    CREATE TABLE IF NOT EXISTS handle_avatars (
      handle TEXT PRIMARY KEY,
      avatar_key TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Cross-section profile extras keyed by handle: bio, a cover banner, and a
    -- JSON array of labeled links ([{label,url}]). Works for any identity type.
    CREATE TABLE IF NOT EXISTS profile_extras (
      handle TEXT PRIMARY KEY,
      bio TEXT,
      links_json TEXT,
      banner_key TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_post_hashtags_tag ON post_hashtags(tag);
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

  // Content hash on post_media so the importer can skip an image it already
  // has for a creator (idempotent re-drops, no duplicates).
  const postMediaCols = (
    db.prepare("PRAGMA table_info(post_media)").all() as { name: string }[]
  ).map((c) => c.name);
  if (postMediaCols.length > 0 && !postMediaCols.includes("content_hash")) {
    db.exec("ALTER TABLE post_media ADD COLUMN content_hash TEXT");
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_post_media_hash ON post_media(content_hash)"
  );

  // distance column on an already-created post_dupe_groups (perceptual Hamming
  // to the kept image, surfaced as a similarity % in the review UI).
  const postDupeCols = (
    db.prepare("PRAGMA table_info(post_dupe_groups)").all() as { name: string }[]
  ).map((c) => c.name);
  if (postDupeCols.length > 0 && !postDupeCols.includes("distance")) {
    db.exec(
      "ALTER TABLE post_dupe_groups ADD COLUMN distance INTEGER NOT NULL DEFAULT 0"
    );
  }

  // Allow following video-only creators: rebuild follows with an expanded CHECK
  // if it still only permits user/creator (SQLite can't ALTER a CHECK in place).
  const followsSql =
    (db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='follows'")
      .get() as { sql: string } | undefined)?.sql ?? "";
  if (followsSql && !followsSql.includes("'shorts'")) {
    db.exec(`
      CREATE TABLE follows_new (
        follower_id INTEGER NOT NULL REFERENCES users(id),
        target_type TEXT NOT NULL CHECK (target_type IN ('user','creator','shorts')),
        target_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (follower_id, target_type, target_id)
      );
      INSERT INTO follows_new SELECT * FROM follows;
      DROP TABLE follows;
      ALTER TABLE follows_new RENAME TO follows;
      CREATE INDEX IF NOT EXISTS idx_follows_target ON follows(target_type, target_id);
    `);
  }

  // Per-user preference: surface 18+ content outside the dedicated Shorts 18+
  // section (still requires the PIN cookie to actually view). Default off.
  const profileColumns = (
    db.prepare("PRAGMA table_info(user_profiles)").all() as { name: string }[]
  ).map((c) => c.name);
  if (profileColumns.length > 0 && !profileColumns.includes("show_adult_outside")) {
    db.exec(
      "ALTER TABLE user_profiles ADD COLUMN show_adult_outside INTEGER NOT NULL DEFAULT 0"
    );
  }

  // Give every existing user a public profile (username/avatar/bio) so the posts
  // module and attribution work. Username = slugified email local-part, with a
  // numeric suffix on collision; the user can change it later in settings.
  const usersNeedingProfile = db
    .prepare(
      `SELECT u.id, u.email FROM users u
        LEFT JOIN user_profiles p ON p.user_id = u.id
       WHERE p.user_id IS NULL`
    )
    .all() as { id: number; email: string }[];
  if (usersNeedingProfile.length > 0) {
    const exists = db.prepare(
      "SELECT 1 FROM user_profiles WHERE username = ? LIMIT 1"
    );
    const insertProfile = db.prepare(
      "INSERT INTO user_profiles (user_id, username) VALUES (?, ?)"
    );
    for (const u of usersNeedingProfile) {
      const base =
        (u.email.split("@")[0] || `user${u.id}`)
          .toLowerCase()
          .replace(/[^a-z0-9._]+/g, "")
          .replace(/^[._]+|[._]+$/g, "")
          .slice(0, 30) || `user${u.id}`;
      let username = base;
      let n = 1;
      while (exists.get(username)) username = `${base}${n++}`;
      insertProfile.run(u.id, username);
    }
  }

  // Full-text search over post captions (FTS5). Guarded: if the SQLite build
  // lacks FTS5 the posts search falls back to LIKE, so this must not throw.
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts
        USING fts5(caption, content='posts', content_rowid='id');
      CREATE TRIGGER IF NOT EXISTS posts_ai AFTER INSERT ON posts BEGIN
        INSERT INTO posts_fts(rowid, caption) VALUES (new.id, new.caption);
      END;
      CREATE TRIGGER IF NOT EXISTS posts_ad AFTER DELETE ON posts BEGIN
        INSERT INTO posts_fts(posts_fts, rowid, caption) VALUES('delete', old.id, old.caption);
      END;
      CREATE TRIGGER IF NOT EXISTS posts_au AFTER UPDATE ON posts BEGIN
        INSERT INTO posts_fts(posts_fts, rowid, caption) VALUES('delete', old.id, old.caption);
        INSERT INTO posts_fts(rowid, caption) VALUES (new.id, new.caption);
      END;
    `);
  } catch {
    /* FTS5 unavailable — search uses a LIKE fallback */
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

export interface ShortDupeGroupRow {
  group_key: string;
  short_id: number;
  channel: ShortChannel;
  match_type: "exact" | "perceptual";
  quality_score: number;
  is_best: number;
  scanned_at: string;
}

export interface ShortDupeStateRow {
  id: number;
  status: "idle" | "running" | "done" | "error";
  started_at: string | null;
  finished_at: string | null;
  scanned: number;
  groups: number;
  message: string | null;
}

export interface ShortTitleStateRow {
  id: number;
  status: "idle" | "running" | "done" | "error";
  started_at: string | null;
  finished_at: string | null;
  processed: number;
  updated: number;
  total: number;
  message: string | null;
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

// --- Posts module (Instagram-style social photo feed) ---

export interface UserProfileRow {
  user_id: number;
  username: string;
  display_name: string | null;
  avatar_key: string | null;
  bio: string | null;
  show_adult_outside: number;
  created_at: string;
}

export interface PostCreatorRow {
  id: number;
  username: string;
  display_name: string | null;
  avatar_key: string | null;
  bio: string | null;
  source: string;
  is_adult: number;
  created_at: string;
}

export interface PostRow {
  id: number;
  author_user_id: number | null;
  author_creator_id: number | null;
  caption: string | null;
  is_adult: number;
  created_at: string;
  is_deleted: number;
}

export interface PostMediaRow {
  id: number;
  post_id: number;
  storage_key: string;
  mime_type: string;
  width: number | null;
  height: number | null;
  position: number;
  media_version: number;
}

export interface PostCommentRow {
  id: number;
  post_id: number;
  user_id: number;
  body: string;
  created_at: string;
}

export interface PostDupeStateRow {
  id: number;
  status: "idle" | "running" | "done" | "error";
  started_at: string | null;
  finished_at: string | null;
  scanned: number;
  groups: number;
  message: string | null;
}

export type FollowTargetType = "user" | "creator" | "shorts";

export interface FollowRow {
  follower_id: number;
  target_type: FollowTargetType;
  target_id: number;
  created_at: string;
}

export interface StoryRow {
  id: number;
  author_user_id: number;
  storage_key: string;
  mime_type: string;
  media_version: number;
  created_at: string;
  expires_at: string;
}

export type NotificationType = "like" | "comment" | "follow" | "mention";

export interface NotificationRow {
  id: number;
  user_id: number;
  type: NotificationType;
  actor_user_id: number;
  post_id: number | null;
  comment_id: number | null;
  created_at: string;
  read_at: string | null;
}
