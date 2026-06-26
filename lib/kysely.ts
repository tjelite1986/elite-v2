import { Kysely, SqliteDialect, type Compilable } from "kysely";
import {
  db as sqlite,
  type UserRow,
  type CodeRow,
  type InviteRequestRow,
  type MessageRow,
  type GalleryItemRow,
  type GalleryAlbumRow,
  type ShortRow,
  type ShortCommentRow,
  type ShortDupeGroupRow,
  type ShortDupeStateRow,
  type ShortTitleStateRow,
  type ShortProfileRow,
  type UserProfileRow,
  type PostCreatorRow,
  type PostRow,
  type PostMediaRow,
  type PostCommentRow,
  type PostDupeStateRow,
  type FollowRow,
  type StoryRow,
  type AppRow,
  type AppVersionRow,
  type AppScreenshotRow,
  type AppReviewRow,
  type NotificationRow,
} from "./db";

// --- Link / state tables that don't (yet) have a hand-written *Row interface
// in db.ts. Typed here directly from the real schema. If any of these grows a
// proper row interface in db.ts later, swap the inline type for an import so
// db.ts stays the single source of truth. ---
interface GalleryAlbumItemRow {
  album_id: number;
  item_id: number;
  added_at: string;
}
interface HandleAvatarRow {
  handle: string;
  avatar_key: string;
  updated_at: string;
}
interface PostDupeGroupRow {
  group_key: string;
  media_id: number;
  post_id: number;
  match_type: string;
  quality_score: number;
  is_best: number;
  scanned_at: string;
  distance: number;
}
interface PostDupeIgnoredRow {
  a_media_id: number;
  b_media_id: number;
  created_at: string;
}
interface PostHashtagRow {
  post_id: number;
  tag: string;
}
interface PostLikeRow {
  post_id: number;
  user_id: number;
  created_at: string;
}
interface MediaFpRow {
  // shared shape of post_media_fp (keyed by media_id) and short_media_fp (short_id)
  size_bytes: number;
  sha: string | null;
  sig: string | null;
  updated_at: string;
}
interface ProfileExtraRow {
  handle: string;
  bio: string | null;
  links_json: string | null;
  fields_json: string | null;
  location: string | null;
  banner_key: string | null;
  updated_at: string;
  instagram_handle: string | null;
  ig_auto_poll: number;
  ig_last_synced_at: string | null;
  ig_last_sync_error: string | null;
  ig_syncing: number;
}
interface SavedAppRow {
  user_id: number;
  app_id: number;
  saved_at: string;
}
interface ShortLikeRow {
  short_id: number;
  user_id: number;
  created_at: string;
}
interface ShortPlaylistRow {
  id: number;
  user_id: number;
  name: string;
  created_at: string;
}
interface ShortPlaylistItemRow {
  playlist_id: number;
  short_id: number;
  added_at: string;
}
interface StoryViewRow {
  story_id: number;
  user_id: number;
  viewed_at: string;
}
interface UserAppInstallRow {
  user_id: number;
  app_id: number;
  installed_at: string;
  pinned: number;
  last_opened_at: string | null;
}

// Complete typed schema map. Reuses the hand-written row interfaces from db.ts
// (which already get updated on every migration) so there is no second source
// of truth, and literal unions (ShortChannel, role, status, ...) carry over.
export interface DB {
  users: UserRow;
  registration_codes: CodeRow;
  invite_requests: InviteRequestRow;
  messages: MessageRow;
  gallery_items: GalleryItemRow;
  gallery_albums: GalleryAlbumRow;
  gallery_album_items: GalleryAlbumItemRow;
  shorts: ShortRow;
  short_comments: ShortCommentRow;
  short_likes: ShortLikeRow;
  short_profiles: ShortProfileRow;
  short_playlists: ShortPlaylistRow;
  short_playlist_items: ShortPlaylistItemRow;
  short_dupe_groups: ShortDupeGroupRow;
  short_dupe_state: ShortDupeStateRow;
  short_title_state: ShortTitleStateRow;
  short_media_fp: MediaFpRow & { short_id: number };
  user_profiles: UserProfileRow;
  post_creators: PostCreatorRow;
  posts: PostRow;
  post_media: PostMediaRow;
  post_media_fp: MediaFpRow & { media_id: number };
  post_comments: PostCommentRow;
  post_likes: PostLikeRow;
  post_hashtags: PostHashtagRow;
  post_dupe_groups: PostDupeGroupRow;
  post_dupe_ignored: PostDupeIgnoredRow;
  post_dupe_state: PostDupeStateRow;
  follows: FollowRow;
  stories: StoryRow;
  story_views: StoryViewRow;
  notifications: NotificationRow;
  profile_extras: ProfileExtraRow;
  handle_avatars: HandleAvatarRow;
  apps: AppRow;
  app_versions: AppVersionRow;
  app_screenshots: AppScreenshotRow;
  app_reviews: AppReviewRow;
  saved_apps: SavedAppRow;
  user_app_installs: UserAppInstallRow;
}

// Kysely is used ONLY to build and type-check queries. Execution stays
// synchronous through the existing better-sqlite3 connection (same WAL, same
// singleton), so the app's sync data layer is preserved and no caller has to
// become async. Kysely never drives the dialect (.execute() is never called);
// the dialect database is only here to satisfy the constructor.
export const qb = new Kysely<DB>({
  dialect: new SqliteDialect({ database: sqlite }),
});

// Compile a SELECT and run it synchronously via better-sqlite3.
export function getOne<T>(query: Compilable<unknown>): T | undefined {
  const { sql, parameters } = query.compile();
  return sqlite.prepare(sql).get(...(parameters as unknown[])) as T | undefined;
}

export function getAll<T>(query: Compilable<unknown>): T[] {
  const { sql, parameters } = query.compile();
  return sqlite.prepare(sql).all(...(parameters as unknown[])) as T[];
}

// Compile an INSERT/UPDATE/DELETE and run it synchronously. Returns the
// better-sqlite3 result (lastInsertRowid, changes).
export function runSync(query: Compilable<unknown>) {
  const { sql, parameters } = query.compile();
  return sqlite.prepare(sql).run(...(parameters as unknown[]));
}
