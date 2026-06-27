import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import path from "path";
import { hashPassword } from "./password";
import { syncArchiveCatalog } from "./appstore-sync";

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
  // Wait for a busy DB instead of failing immediately.
  db.pragma("busy_timeout = 5000");
  // Serialize migrations across processes. `next build` collects page data in
  // several worker processes, each of which opens the DB and runs migrate()
  // against a fresh file; without a lock they race on `ALTER TABLE ADD COLUMN`
  // ("duplicate column name"). BEGIN IMMEDIATE takes the write lock up front, so
  // a second process waits (busy_timeout) and then reads the already-migrated
  // schema, skipping the guarded ALTERs. Runtime reuses one connection, so this
  // only matters at build time — but it's correct either way.
  db.exec("BEGIN IMMEDIATE");
  try {
    migrate(db);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  seedAdmin(db);
  seedContentOwners(db);
  seedAppStore(db);
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
      reply_to INTEGER,
      edited_at TEXT,
      deleted_at TEXT,
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
      rating INTEGER NOT NULL DEFAULT 0,
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

    -- Public (no-auth) share links for an album, addressed by an opaque token.
    CREATE TABLE IF NOT EXISTS album_shares (
      token TEXT PRIMARY KEY,
      album_id INTEGER NOT NULL REFERENCES gallery_albums(id) ON DELETE CASCADE,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_album_shares_album ON album_shares(album_id);

    -- Saved smart albums: a named, dynamic filter (resolves to matching items).
    CREATE TABLE IF NOT EXISTS smart_albums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      criteria_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_smart_albums_user ON smart_albums(user_id);

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
      -- 0 = public (everyone on the channel), 1 = private (only the uploader + admins).
      is_private INTEGER NOT NULL DEFAULT 0,
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

    -- Linked aliases: when an admin merges several profiles for the same model
    -- (different handles, e.g. @lillielucas + @lillieinlove) into one, each
    -- merged-away name maps to the surviving profile so a future import of that
    -- handle reuses it instead of recreating a duplicate. Names stored lowercase.
    CREATE TABLE IF NOT EXISTS short_profile_aliases (
      channel TEXT NOT NULL,
      name TEXT NOT NULL,
      profile_id INTEGER NOT NULL REFERENCES short_profiles(id) ON DELETE CASCADE,
      PRIMARY KEY (channel, name)
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
      accent TEXT,
      bg_theme TEXT,
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

    -- Cross-section profile extras keyed by handle: bio, a cover banner, a JSON
    -- array of labeled links ([{label,url}]), and the Instagram cookie-sync
    -- config/status for this person. Works for any identity type. The IG source
    -- (instagram_handle) can differ from the local handle; synced media is
    -- imported under the local handle so it attaches to THIS profile.
    CREATE TABLE IF NOT EXISTS profile_extras (
      handle TEXT PRIMARY KEY,
      bio TEXT,
      links_json TEXT,
      fields_json TEXT,
      location TEXT,
      banner_key TEXT,
      instagram_handle TEXT,
      ig_auto_poll INTEGER NOT NULL DEFAULT 0,
      ig_last_synced_at TEXT,
      ig_last_sync_error TEXT,
      ig_syncing INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_post_hashtags_tag ON post_hashtags(tag);

    -- Login throttle: per-identifier (lowercased email) failed-attempt counter
    -- with an escalating lockout ladder. A successful login clears the row.
    CREATE TABLE IF NOT EXISTS login_attempts (
      identifier TEXT PRIMARY KEY,
      fails INTEGER NOT NULL DEFAULT 0,
      first_fail_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_fail_at TEXT NOT NULL DEFAULT (datetime('now')),
      locked_until TEXT
    );

    -- Web Push subscriptions (one row per browser/device endpoint). Used to send
    -- notifications when the app/tab is closed.
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);

    -- Shared bookshelf: EPUB/PDF/CBZ documents with per-user reading progress.
    CREATE TABLE IF NOT EXISTS books (
      slug TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT,
      format TEXT NOT NULL CHECK (format IN ('epub', 'pdf', 'cbz')),
      storage_key TEXT NOT NULL,        -- filename within BOOKS_ROOT
      cover_key TEXT,                   -- filename within BOOKS_ROOT/.covers
      size_bytes INTEGER,
      page_count INTEGER,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      added_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_books_added ON books(added_at DESC);

    CREATE TABLE IF NOT EXISTS book_reading_state (
      book_slug TEXT NOT NULL REFERENCES books(slug) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      position TEXT,                    -- EPUB: CFI; PDF/CBZ: page index as text
      percent INTEGER NOT NULL DEFAULT 0,
      last_read_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      PRIMARY KEY (book_slug, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_book_state_user
      ON book_reading_state(user_id, last_read_at DESC);

    -- Group channels (public chat rooms) alongside 1:1 DMs.
    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS channel_members (
      channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_read_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (channel_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS channel_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      reply_to INTEGER,
      edited_at TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_channel_messages_ch
      ON channel_messages(channel_id, id);

    -- Emoji reactions on messages. scope distinguishes DM vs channel id-spaces.
    CREATE TABLE IF NOT EXISTS message_reactions (
      scope TEXT NOT NULL,        -- 'dm' | 'channel'
      message_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (scope, message_id, user_id, emoji)
    );
    CREATE INDEX IF NOT EXISTS idx_message_reactions
      ON message_reactions(scope, message_id);

    -- Revocable login sessions (one row per device/browser). The JWT carries a
    -- jti; getSession (Node) rejects tokens whose jti row is gone (revoked).
    CREATE TABLE IF NOT EXISTS sessions (
      jti TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_agent TEXT,
      ip TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user
      ON sessions(user_id, last_seen_at DESC);

    -- User-applied tags on gallery items.
    CREATE TABLE IF NOT EXISTS gallery_tags (
      item_id INTEGER NOT NULL REFERENCES gallery_items(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      PRIMARY KEY (item_id, tag)
    );
    CREATE INDEX IF NOT EXISTS idx_gallery_tags_tag ON gallery_tags(tag);

    -- Auto-earned achievement badges (definitions live in lib/badges.ts).
    CREATE TABLE IF NOT EXISTS user_badges (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      badge_id TEXT NOT NULL,
      earned_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, badge_id)
    );

    -- Admin-granted per-user capabilities (keys defined in lib/permissions.ts).
    -- A row's presence = granted. Admins implicitly have every permission, so
    -- they need no rows here. Gates settings-page visibility per section.
    CREATE TABLE IF NOT EXISTS user_permissions (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      permission TEXT NOT NULL,
      granted_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, permission)
    );
  `);

  // Backfill the Instagram-sync columns on profile_extras for older databases.
  {
    const cols = (
      db.prepare("PRAGMA table_info(profile_extras)").all() as { name: string }[]
    ).map((c) => c.name);
    if (!cols.includes("instagram_handle"))
      db.exec("ALTER TABLE profile_extras ADD COLUMN instagram_handle TEXT");
    if (!cols.includes("ig_auto_poll"))
      db.exec("ALTER TABLE profile_extras ADD COLUMN ig_auto_poll INTEGER NOT NULL DEFAULT 0");
    if (!cols.includes("ig_last_synced_at"))
      db.exec("ALTER TABLE profile_extras ADD COLUMN ig_last_synced_at TEXT");
    if (!cols.includes("ig_last_sync_error"))
      db.exec("ALTER TABLE profile_extras ADD COLUMN ig_last_sync_error TEXT");
    if (!cols.includes("ig_syncing"))
      db.exec("ALTER TABLE profile_extras ADD COLUMN ig_syncing INTEGER NOT NULL DEFAULT 0");
    if (!cols.includes("location"))
      db.exec("ALTER TABLE profile_extras ADD COLUMN location TEXT");
    // Custom profile fields: JSON array of {label, value, public}.
    if (!cols.includes("fields_json"))
      db.exec("ALTER TABLE profile_extras ADD COLUMN fields_json TEXT");
  }

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
  // Reply / edit / soft-delete support on DM messages.
  if (!messageColumns.includes("reply_to"))
    db.exec("ALTER TABLE messages ADD COLUMN reply_to INTEGER");
  if (!messageColumns.includes("edited_at"))
    db.exec("ALTER TABLE messages ADD COLUMN edited_at TEXT");
  if (!messageColumns.includes("deleted_at"))
    db.exec("ALTER TABLE messages ADD COLUMN deleted_at TEXT");

  // Same reply / edit / soft-delete columns on channel messages.
  const channelMsgColumns = (
    db.prepare("PRAGMA table_info(channel_messages)").all() as { name: string }[]
  ).map((c) => c.name);
  if (channelMsgColumns.length > 0) {
    if (!channelMsgColumns.includes("reply_to"))
      db.exec("ALTER TABLE channel_messages ADD COLUMN reply_to INTEGER");
    if (!channelMsgColumns.includes("edited_at"))
      db.exec("ALTER TABLE channel_messages ADD COLUMN edited_at TEXT");
    if (!channelMsgColumns.includes("deleted_at"))
      db.exec("ALTER TABLE channel_messages ADD COLUMN deleted_at TEXT");
  }

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
  // Per-clip visibility: 0 = public (everyone on the channel), 1 = private (only
  // the uploader, plus admins). Default 0 so existing/imported/polled clips stay
  // public; new user uploads default to private in the upload route.
  if (shortColumns.length > 0 && !shortColumns.includes("is_private")) {
    db.exec(
      "ALTER TABLE shorts ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0"
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
    if (!galleryColumns.includes("rating"))
      db.exec("ALTER TABLE gallery_items ADD COLUMN rating INTEGER NOT NULL DEFAULT 0");
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
  // Appearance prefs: accent colour (hex) + background theme key.
  if (profileColumns.length > 0 && !profileColumns.includes("accent"))
    db.exec("ALTER TABLE user_profiles ADD COLUMN accent TEXT");
  if (profileColumns.length > 0 && !profileColumns.includes("bg_theme"))
    db.exec("ALTER TABLE user_profiles ADD COLUMN bg_theme TEXT");

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

  // --- App Store module (phase 1: local APK archive catalog) ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS apps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      developer TEXT,
      tagline TEXT,
      description TEXT,
      category TEXT NOT NULL DEFAULT 'App',
      section TEXT NOT NULL DEFAULT 'apps',     -- apps | games
      website TEXT,
      icon_key TEXT,
      banner_key TEXT,
      source TEXT NOT NULL DEFAULT 'local',      -- local archive; external sources are phase 2
      requires_pin INTEGER NOT NULL DEFAULT 0,   -- adult apps, gated like /shorts18
      featured INTEGER NOT NULL DEFAULT 0,
      editors_choice INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      install_count INTEGER NOT NULL DEFAULT 0,
      rating_avg REAL NOT NULL DEFAULT 0,
      rating_count INTEGER NOT NULL DEFAULT 0,
      current_version TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_apps_browse
      ON apps(enabled, section, category, sort_order);

    CREATE TABLE IF NOT EXISTS app_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
      version TEXT NOT NULL,
      apk_key TEXT NOT NULL,
      file_name TEXT,
      file_size INTEGER NOT NULL DEFAULT 0,
      is_current INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(app_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_app_versions_app ON app_versions(app_id);

    CREATE TABLE IF NOT EXISTS app_screenshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
      image_key TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_app_screenshots_app ON app_screenshots(app_id, sort_order);

    CREATE TABLE IF NOT EXISTS app_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      body TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT,
      UNIQUE(app_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_app_reviews_app ON app_reviews(app_id, created_at);

    CREATE TABLE IF NOT EXISTS user_app_installs (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
      installed_at TEXT NOT NULL DEFAULT (datetime('now')),
      pinned INTEGER NOT NULL DEFAULT 0,
      last_opened_at TEXT,
      PRIMARY KEY (user_id, app_id)
    );
    CREATE INDEX IF NOT EXISTS idx_user_app_installs_user ON user_app_installs(user_id);

    CREATE TABLE IF NOT EXISTS saved_apps (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
      saved_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, app_id)
    );
  `);

  // Phase 2: external sources (GitHub / F-Droid / Play Store) + update tracking.
  // Added via backfill so the live phase-1 catalog gets the new columns.
  {
    // Add a column if missing; tolerate "duplicate column" so a concurrent /
    // repeated migrate (e.g. across bundled chunks during a production build)
    // can never crash boot.
    const addColumn = (table: string, existing: string[], name: string, decl: string) => {
      if (existing.includes(name)) return;
      try {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${decl}`);
      } catch (err) {
        if (!/duplicate column/i.test((err as Error).message)) throw err;
      }
    };

    const appCols = (
      db.prepare("PRAGMA table_info(apps)").all() as { name: string }[]
    ).map((c) => c.name);
    const addApp = (name: string, decl: string) =>
      addColumn("apps", appCols, name, decl);
    addApp("source_repo", "TEXT");
    addApp("source_package", "TEXT");
    addApp("source_url", "TEXT");
    addApp("homepage", "TEXT");
    addApp("auto_update", "INTEGER NOT NULL DEFAULT 0");
    addApp("update_available", "INTEGER NOT NULL DEFAULT 0");
    addApp("available_version", "TEXT");
    addApp("last_checked_at", "TEXT");
    addApp("signing_cert", "TEXT");
    addApp("review_flag", "TEXT");
    addApp("source_meta", "TEXT");
    // A Play Store package linked to an EXISTING app (any primary source) purely
    // for metadata enrichment + version-check — never changes how the app is served.
    addApp("play_package", "TEXT");
    // A latestmodapks.com page URL linked for metadata/banner/version-check
    // (mod apps not on Play/F-Droid). Scraped via curl-impersonate.
    addApp("modapk_url", "TEXT");

    const verCols = (
      db.prepare("PRAGMA table_info(app_versions)").all() as { name: string }[]
    ).map((c) => c.name);
    const addVer = (name: string, decl: string) =>
      addColumn("app_versions", verCols, name, decl);
    addVer("storage", "TEXT NOT NULL DEFAULT 'archive'");
    addVer("download_url", "TEXT");
    addVer("sha256", "TEXT");
    addVer("verify_status", "TEXT");
    addVer("downloaded_at", "TEXT");

    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_apps_source ON apps(source, update_available)"
    );
  }

  // Background-job scheduler. Each row is one job from lib/jobs-runtime.mjs the
  // admin can enable/disable and schedule from the in-app Background Jobs panel,
  // replacing the host systemd timers. The runtime (server.mjs) owns the writes;
  // name/description are seeded from the registry so the API can render the list
  // without importing the registry.
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

// Content-owner accounts (public@ / adults@): seeded from env like the admin so
// they survive DB resets. Plain 'user' role on purpose — they are login/
// maintenance buckets, never admin (also matters for the act-as guard). Profiles
// + home folders are provisioned separately in provisionContentOwners(), since
// that path reaches the DB through the module-level `db` export which isn't
// assigned yet while createDb() runs.
const CONTENT_OWNER_ENV: readonly [emailVar: string, passVar: string][] = [
  ["PUBLIC_EMAIL", "PUBLIC_PASSWORD"],
  ["ADULTS_EMAIL", "ADULTS_PASSWORD"],
];

function seedContentOwners(db: Database.Database) {
  for (const [emailVar, passVar] of CONTENT_OWNER_ENV) {
    const email = process.env[emailVar];
    const password = process.env[passVar];
    if (!email || !password) continue;
    const existing = db
      .prepare("SELECT id FROM users WHERE email = ?")
      .get(email.toLowerCase());
    if (existing) continue;
    db.prepare(
      "INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'user')"
    ).run(email.toLowerCase(), hashPassword(password));
  }
}


// Populate the App Store catalog from the on-disk archive the first time (when
// the apps table is empty). Reads only small metadata files, never APK bytes, so
// it is cheap. Idempotent: skips entirely once seeded. Admins can force a rescan
// via the manage page. Wrapped so a missing/unreadable archive never breaks boot.
function seedAppStore(db: Database.Database) {
  try {
    const count = (
      db.prepare("SELECT COUNT(*) AS n FROM apps").get() as { n: number }
    ).n;
    if (count > 0) return;
    syncArchiveCatalog(db);
  } catch (err) {
    console.error("App Store seed skipped:", (err as Error).message);
  }
}

export const db = globalForDb.db ?? createDb();
if (process.env.NODE_ENV !== "production") globalForDb.db = db;

// Deferred to the next tick so this module finishes evaluating first, then give
// the seeded content owners their profile + home tree. Loaded via require() here
// (lazily) so the db<->profiles<->kysely import cycle is already resolved by the
// time seed-content-owners' top-level imports run. Idempotent per boot.
setImmediate(() => {
  import("./seed-content-owners")
    .then((m) => m.provisionContentOwners())
    .catch((err) =>
      console.error(
        "Content-owner provisioning failed:",
        (err as Error)?.message
      )
    );
});

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
  reply_to: number | null;
  edited_at: string | null;
  deleted_at: string | null;
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
  rating: number;
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
  is_private: number;
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

// --- App Store module ---

export interface AppRow {
  id: number;
  slug: string;
  name: string;
  developer: string | null;
  tagline: string | null;
  description: string | null;
  category: string;
  section: "apps" | "games";
  website: string | null;
  icon_key: string | null;
  banner_key: string | null;
  source: string;
  requires_pin: number;
  featured: number;
  editors_choice: number;
  enabled: number;
  sort_order: number;
  install_count: number;
  rating_avg: number;
  rating_count: number;
  current_version: string | null;
  created_at: string;
  // Phase 2: external sources + updates (nullable for phase-1 'local' apps).
  source_repo: string | null;
  source_package: string | null;
  source_url: string | null;
  homepage: string | null;
  auto_update: number;
  update_available: number;
  available_version: string | null;
  last_checked_at: string | null;
  signing_cert: string | null;
  review_flag: string | null;
  source_meta: string | null;
  play_package: string | null;
  modapk_url: string | null;
}

export interface AppVersionRow {
  id: number;
  app_id: number;
  version: string;
  apk_key: string;
  file_name: string | null;
  file_size: number;
  is_current: number;
  created_at: string;
  // Phase 2
  storage: "archive" | "download";
  download_url: string | null;
  sha256: string | null;
  verify_status: string | null;
  downloaded_at: string | null;
}

export interface AppScreenshotRow {
  id: number;
  app_id: number;
  image_key: string;
  sort_order: number;
}

export interface AppReviewRow {
  id: number;
  app_id: number;
  user_id: number;
  rating: number;
  body: string | null;
  created_at: string;
  updated_at: string | null;
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
