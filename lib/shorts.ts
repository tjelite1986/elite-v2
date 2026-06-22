import { sql } from "kysely";
import { ShortRow, ShortChannel, ShortCategory } from "./db";
import { qb, getOne, getAll } from "./kysely";
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
  return getOne<ShortRow>(
    qb
      .selectFrom("shorts")
      .selectAll()
      .where("id", "=", id)
      .where("is_deleted", "=", 0)
  );
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
  // Structure (joins, filters, ordering, pagination) is built with the typed
  // builder. The correlated count/exists columns stay as sql`` fragments —
  // this is exactly the "gnarliest queries fall partly back to raw SQL" case.
  const query = qb
    .selectFrom("shorts as s")
    .leftJoin("users as u", "u.id", "s.uploader_id")
    .leftJoin("short_profiles as p", "p.id", "s.profile_id")
    .select([
      "s.id",
      "s.channel",
      "s.category",
      "s.caption",
      "s.uploader_id",
      "s.profile_id",
      "s.width",
      "s.height",
      "s.duration",
      "s.created_at",
      "s.poster_key",
      "u.email as uploader_email",
      "p.name as profile_name",
      sql<number>`(SELECT COUNT(*) FROM short_likes l WHERE l.short_id = s.id)`.as(
        "like_count"
      ),
      sql<number>`(SELECT COUNT(*) FROM short_comments c WHERE c.short_id = s.id)`.as(
        "comment_count"
      ),
      sql<number>`EXISTS(SELECT 1 FROM short_likes l WHERE l.short_id = s.id AND l.user_id = ${viewerId})`.as(
        "viewer_liked"
      ),
      sql<number>`EXISTS(SELECT 1 FROM short_playlist_items pi JOIN short_playlists pl ON pl.id = pi.playlist_id WHERE pi.short_id = s.id AND pl.user_id = ${viewerId})`.as(
        "viewer_saved"
      ),
    ])
    .where("s.is_deleted", "=", 0)
    .where("s.status", "=", "ready")
    // Dynamic filters: conditional .where() replaces the (@x IS NULL OR ...) trick.
    .$if(profileId !== null, (q) => q.where("s.profile_id", "=", profileId!))
    .$if(profileId === null && playlistId === null, (q) =>
      q.where("s.channel", "=", channel)
    )
    .$if(category !== null, (q) => q.where("s.category", "=", category!))
    .$if(playlistId !== null, (q) =>
      q.where(
        "s.id",
        "in",
        qb
          .selectFrom("short_playlist_items")
          .select("short_id")
          .where("playlist_id", "=", playlistId!)
      )
    )
    .$if(cursor !== null, (q) => q.where("s.id", "<", cursor!))
    .orderBy("s.id", "desc")
    .limit(limit + 1);

  const rows = getAll<FeedRow>(query);

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
  return getOne<ProfileSummary>(
    qb
      .selectFrom("short_profiles as p")
      .select((eb) => [
        "p.id",
        "p.name",
        "p.channel",
        // Pure-builder correlated subquery — no raw SQL needed here.
        eb
          .selectFrom("shorts as s")
          .select((e) => e.fn.countAll<number>().as("c"))
          .whereRef("s.profile_id", "=", "p.id")
          .where("s.is_deleted", "=", 0)
          .where("s.status", "=", "ready")
          .as("clip_count"),
      ])
      .where("p.id", "=", id)
  );
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
  return getAll<CreatorCard>(
    qb
      .selectFrom("short_profiles as p")
      .innerJoin("shorts as s", "s.profile_id", "p.id")
      .select((eb) => [
        "p.id",
        "p.name",
        "p.channel",
        eb.fn.count<number>("s.id").as("clip_count"),
        eb.fn.max("s.id").as("cover_id"),
      ])
      .where("s.is_deleted", "=", 0)
      .where("s.status", "=", "ready")
      .where("p.channel", "=", channel)
      .groupBy("p.id")
      .orderBy("clip_count", "desc")
      .orderBy("p.name", "asc")
  );
}
