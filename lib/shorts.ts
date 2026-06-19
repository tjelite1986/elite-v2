import { db, ShortRow, ShortChannel, ShortCategory } from "./db";
import { has18Access } from "./shorts-gate";

export function parseChannel(value: string | null | undefined): ShortChannel {
  return value === "18plus" ? "18plus" : "main";
}

// A user may always see the main channel. The 18+ channel additionally requires
// a valid PIN-unlock cookie. Checked here so every route enforces it the same
// way — the gate is never assumed from another layer.
export async function canAccessChannel(channel: ShortChannel): Promise<boolean> {
  if (channel === "main") return true;
  return has18Access();
}

export function getShort(id: number): ShortRow | undefined {
  return db
    .prepare("SELECT * FROM shorts WHERE id = ? AND is_deleted = 0")
    .get(id) as ShortRow | undefined;
}

export interface FeedShort {
  id: number;
  channel: ShortChannel;
  category: ShortCategory;
  caption: string | null;
  uploader_id: number | null;
  uploader_email: string | null;
  profile_id: number | null;
  profile_name: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  created_at: string;
  like_count: number;
  comment_count: number;
  viewer_liked: boolean;
  viewer_saved: boolean;
  has_poster: boolean;
}

interface FeedRow extends ShortRow {
  uploader_email: string | null;
  profile_name: string | null;
  like_count: number;
  comment_count: number;
  viewer_liked: number;
  viewer_saved: number;
}

// Cursor-paginated feed, newest first. The cursor is the last short id seen (ids
// are monotonic). Scope is either a whole channel or a single profile (when
// profileId is set, the channel filter is dropped — the caller gates 18+ access
// from the profile's own channel). Includes like/comment counts, whether the
// viewer liked each clip, and the poster's profile name for attribution.
export function getFeed(
  channel: ShortChannel,
  viewerId: number,
  cursor: number | null,
  limit = 10,
  profileId: number | null = null,
  playlistId: number | null = null,
  category: ShortCategory | null = null
): { items: FeedShort[]; nextCursor: number | null } {
  const rows = db
    .prepare(
      `SELECT s.*,
              u.email AS uploader_email,
              p.name AS profile_name,
              (SELECT COUNT(*) FROM short_likes l WHERE l.short_id = s.id) AS like_count,
              (SELECT COUNT(*) FROM short_comments c WHERE c.short_id = s.id) AS comment_count,
              EXISTS(SELECT 1 FROM short_likes l WHERE l.short_id = s.id AND l.user_id = @viewer) AS viewer_liked,
              EXISTS(SELECT 1 FROM short_playlist_items pi
                       JOIN short_playlists pl ON pl.id = pi.playlist_id
                      WHERE pi.short_id = s.id AND pl.user_id = @viewer) AS viewer_saved
         FROM shorts s
         LEFT JOIN users u ON u.id = s.uploader_id
         LEFT JOIN short_profiles p ON p.id = s.profile_id
        WHERE s.is_deleted = 0
          AND s.status = 'ready'
          AND (@profileId IS NULL OR s.profile_id = @profileId)
          AND (@profileId IS NOT NULL OR @playlistId IS NOT NULL OR s.channel = @channel)
          AND (@category IS NULL OR s.category = @category)
          AND (@playlistId IS NULL OR s.id IN
                (SELECT short_id FROM short_playlist_items WHERE playlist_id = @playlistId))
          AND (@cursor IS NULL OR s.id < @cursor)
        ORDER BY s.id DESC
        LIMIT @limit`
    )
    .all({
      channel,
      viewer: viewerId,
      cursor,
      profileId,
      playlistId,
      category,
      limit: limit + 1,
    }) as FeedRow[];

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const items: FeedShort[] = page.map((r) => ({
    id: r.id,
    channel: r.channel,
    category: r.category,
    caption: r.caption,
    uploader_id: r.uploader_id,
    uploader_email: r.uploader_email,
    profile_id: r.profile_id,
    profile_name: r.profile_name,
    width: r.width,
    height: r.height,
    duration: r.duration,
    created_at: r.created_at,
    like_count: Number(r.like_count),
    comment_count: Number(r.comment_count),
    viewer_liked: Boolean(r.viewer_liked),
    viewer_saved: Boolean(r.viewer_saved),
    has_poster: Boolean(r.poster_key),
  }));

  const nextCursor = hasMore ? page[page.length - 1].id : null;
  return { items, nextCursor };
}

export interface ProfileSummary {
  id: number;
  name: string;
  channel: ShortChannel;
  clip_count: number;
}

// Public-facing profile lookup (any authed user, gated by channel) for the
// profile page header.
export function getProfileSummary(id: number): ProfileSummary | undefined {
  return db
    .prepare(
      `SELECT p.id, p.name, p.channel,
              (SELECT COUNT(*) FROM shorts s
                WHERE s.profile_id = p.id AND s.is_deleted = 0 AND s.status = 'ready') AS clip_count
         FROM short_profiles p
        WHERE p.id = ?`
    )
    .get(id) as ProfileSummary | undefined;
}

export interface CreatorCard {
  id: number;
  name: string;
  channel: ShortChannel;
  clip_count: number;
  cover_id: number | null; // newest ready clip → poster thumbnail
}

// Profiles that have at least one ready clip on the given channel, with a cover
// thumbnail + count, for the Profiles grid.
export function getCreators(channel: ShortChannel): CreatorCard[] {
  return db
    .prepare(
      `SELECT p.id, p.name, p.channel,
              COUNT(s.id) AS clip_count,
              MAX(s.id) AS cover_id
         FROM short_profiles p
         JOIN shorts s ON s.profile_id = p.id
        WHERE s.is_deleted = 0 AND s.status = 'ready' AND p.channel = @channel
        GROUP BY p.id
        ORDER BY clip_count DESC, p.name ASC`
    )
    .all({ channel }) as CreatorCard[];
}
