import { sql } from "kysely";
import { db, ShortRow, ShortChannel, ShortCategory } from "./db";
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

// Per-clip visibility: a private clip is only visible to its uploader (and to
// admins, who moderate). Public clips are visible to everyone on the channel.
// Apply this in EVERY read path that serves a clip by id — feed/grids go through
// getFeed (below), single-clip routes load via getShort and must call this.
export function canViewShort(
  short: Pick<ShortRow, "is_private" | "uploader_id">,
  viewerId: number,
  isAdmin: boolean
): boolean {
  return short.is_private === 0 || short.uploader_id === viewerId || isAdmin;
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
  is_private: boolean;
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
  category: ShortCategory | null = null,
  // Privacy: non-admins only see public clips + their own private ones. Admins
  // see everything. `mineOnly` scopes the feed to the viewer's own uploads (the
  // "Mine" view), where both public and private of theirs are wanted.
  isAdmin = false,
  mineOnly = false,
  // Person scope: also include this user's own uploads (uploader_id), unioned
  // with profileId — so a user's uploaded/imported clips show on their unified
  // profile the same way posts union author_user_id. Privacy still applies.
  ownerId: number | null = null,
  // 18+ access: when false (and not admin), 18plus clips are excluded from EVERY
  // scope — including playlists, which otherwise skip the channel filter and
  // would leak adult clips to a viewer who hasn't unlocked the PIN.
  allow18 = false
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
      "s.is_private",
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
    // 18+ gate (defense in depth): a viewer who hasn't unlocked the adult channel
    // never receives 18plus clips through ANY scope. This closes the playlist
    // scope, which skips the per-scope channel filter below. Admins see all.
    .$if(!allow18 && !isAdmin, (q) => q.where("s.channel", "!=", "18plus"))
    // Privacy filter: hide others' private clips. Admins and the "Mine" view skip
    // it (admins see all; Mine is the viewer's own clips, public + private).
    .$if(!isAdmin && !mineOnly, (q) =>
      q.where((eb) =>
        eb.or([eb("s.is_private", "=", 0), eb("s.uploader_id", "=", viewerId)])
      )
    )
    .$if(mineOnly, (q) => q.where("s.uploader_id", "=", viewerId))
    // Dynamic filters: conditional .where() replaces the (@x IS NULL OR ...) trick.
    // Profile/owner scope: a clip belongs to the creator profile (profile_id) OR
    // the person's own uploads (uploader_id) — unioned so a user's uploads show
    // on their profile alongside the creator's imports.
    .$if(profileId !== null || ownerId !== null, (q) =>
      q.where((eb) =>
        eb.or(
          [
            profileId !== null ? eb("s.profile_id", "=", profileId) : null,
            ownerId !== null ? eb("s.uploader_id", "=", ownerId) : null,
          ].filter((c): c is NonNullable<typeof c> => c !== null)
        )
      )
    )
    // Constrain the channel for plain channel browsing AND for owner scope (so an
    // uploader's 18+ clips don't leak into their main grid). A creator-profile-only
    // scope derives the channel from the profile, so it's skipped there.
    .$if(
      (profileId === null && playlistId === null) || ownerId !== null,
      (q) => q.where("s.channel", "=", channel)
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
    is_private: Boolean(r.is_private),
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

// --- Profile merge (link several handles for the same model into one) ---------

export interface MergeProfile {
  id: number;
  name: string;
  clips: number;
}

// Every profile on a channel with its (non-deleted) clip count — INCLUDING ones
// with no ready clips — for the admin merge picker. (getCreators only lists ones
// with a ready clip.)
export function listProfilesForMerge(channel: ShortChannel): MergeProfile[] {
  return db
    .prepare(
      `SELECT p.id AS id, p.name AS name,
              (SELECT COUNT(*) FROM shorts s WHERE s.profile_id = p.id AND s.is_deleted = 0) AS clips
       FROM short_profiles p
       WHERE p.channel = ?
       ORDER BY p.name COLLATE NOCASE`
    )
    .all(channel) as MergeProfile[];
}

// Resolve a handle to a linked profile via the alias table (channel-scoped,
// case-insensitive). Returns null if not aliased.
export function getAliasProfileId(
  channel: ShortChannel,
  name: string
): number | null {
  const row = db
    .prepare(
      "SELECT profile_id FROM short_profile_aliases WHERE channel = ? AND name = ?"
    )
    .get(channel, name.toLowerCase()) as { profile_id: number } | undefined;
  return row?.profile_id ?? null;
}

// Merge the `mergeIds` profiles into `primaryId` (same channel): reassign their
// clips, record each merged name as an alias of the primary (so a future import
// of that handle reuses it), re-point existing aliases, then delete the merged
// rows. Returns counts.
export function mergeShortProfiles(
  primaryId: number,
  mergeIds: number[]
): { reassigned: number; merged: number } {
  const ids = mergeIds.filter((id) => id !== primaryId);
  const primary = db
    .prepare("SELECT id, channel, name FROM short_profiles WHERE id = ?")
    .get(primaryId) as { id: number; channel: string; name: string } | undefined;
  if (!primary) throw new Error("primary profile not found");

  let reassigned = 0;
  let merged = 0;
  const reassign = db.prepare("UPDATE shorts SET profile_id = ? WHERE profile_id = ?");
  const addAlias = db.prepare(
    "INSERT OR REPLACE INTO short_profile_aliases (channel, name, profile_id) VALUES (?, ?, ?)"
  );
  const repoint = db.prepare(
    "UPDATE short_profile_aliases SET profile_id = ? WHERE profile_id = ?"
  );
  const del = db.prepare("DELETE FROM short_profiles WHERE id = ?");

  const tx = db.transaction(() => {
    for (const id of ids) {
      const p = db
        .prepare("SELECT name, channel FROM short_profiles WHERE id = ?")
        .get(id) as { name: string; channel: string } | undefined;
      if (!p || p.channel !== primary.channel) continue; // never merge across channels
      reassigned += Number(reassign.run(primaryId, id).changes);
      addAlias.run(primary.channel, p.name.toLowerCase(), primaryId);
      repoint.run(primaryId, id);
      del.run(id);
      merged++;
    }
  });
  tx();
  return { reassigned, merged };
}
