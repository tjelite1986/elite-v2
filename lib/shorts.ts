import { sql } from "kysely";
import { db, ShortRow, ShortChannel, ShortCategory } from "./db";
import { qb, getOne, getAll } from "./kysely";
import { has18Access } from "./shorts-gate";
import { personContentIds } from "./profile-links";

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

export type ShortsSort =
  | "new"
  | "foryou"
  | "following"
  | "liked"
  | "random";

export function parseShortsSort(raw: string | null): ShortsSort {
  return raw === "foryou" ||
    raw === "following" ||
    raw === "liked" ||
    raw === "random"
    ? raw
    : "new";
}

// Clip-length filter. The cut is the shorts format's own 60 seconds: below it a
// clip is something you swipe past, above it something you sit through, and the
// library splits cleanly there. A clip whose duration never got probed has no
// length to judge, so it belongs to neither side and only shows under "all".
export const SHORT_MAX_SECONDS = 60;

export type ShortsLength = "all" | "short" | "long";

export function parseShortsLength(raw: string | null): ShortsLength {
  return raw === "short" || raw === "long" ? raw : "all";
}

// The set of shorts a viewer "follows" on a channel, for the Following feed.
// A person is one identity with several faces — a real user account, a post
// creator, one or more shorts profiles — and a follow may be recorded on ANY of
// them (a shorts follow from the shorts profile page stores target_type
// 'shorts'; a follow from the /people page stores 'user' or 'creator'). So we
// can't just match target_type 'shorts'/'user' on the raw ids — we resolve each
// followed face to its handle and expand it through the unified-person graph
// (personContentIds) to every shorts profile + owner-user id on this channel.
// Without this, following someone via /people (creator) never surfaced their
// shorts, and following the main profile didn't cover their 18+ profile.
export function followedShortsScope(
  viewerId: number,
  channel: ShortChannel
): { profileIds: number[]; userIds: number[] } {
  const include18 = channel === "18plus";
  const follows = db
    .prepare("SELECT target_type, target_id FROM follows WHERE follower_id = ?")
    .all(viewerId) as { target_type: string; target_id: number }[];
  const profileIds = new Set<number>();
  const userIds = new Set<number>();
  const handles: string[] = [];

  for (const f of follows) {
    if (f.target_type === "shorts") {
      const r = db
        .prepare("SELECT name, channel FROM short_profiles WHERE id = ?")
        .get(f.target_id) as { name: string; channel: string } | undefined;
      if (r) {
        if (r.channel === channel) profileIds.add(f.target_id);
        handles.push(r.name);
      }
    } else if (f.target_type === "user") {
      userIds.add(f.target_id); // a followed user's own uploads (uploader_id)
      const r = db
        .prepare("SELECT username FROM user_profiles WHERE user_id = ?")
        .get(f.target_id) as { username: string } | undefined;
      if (r) handles.push(r.username);
    } else if (f.target_type === "creator") {
      const r = db
        .prepare("SELECT username FROM post_creators WHERE id = ?")
        .get(f.target_id) as { username: string } | undefined;
      if (r) handles.push(r.username);
    }
  }

  for (const h of handles) {
    const ids = personContentIds(h, include18);
    for (const id of include18 ? ids.shorts18Ids : ids.shortsMainIds)
      profileIds.add(id);
    for (const id of ids.userIds) userIds.add(id);
  }
  return { profileIds: [...profileIds], userIds: [...userIds] };
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
  source: string;
  source_id: string | null;
  like_count: number;
  comment_count: number;
  viewer_liked: boolean;
  viewer_saved: boolean;
  has_poster: boolean;
  // Cache-busting token for the poster URL, derived from the poster file key so
  // it changes whenever the cover frame is replaced. The grid uses it as
  // `?v=<poster_v>` — without a per-poster token the service worker (cache-first
  // on poster URLs) would keep serving the old cover under a constant query.
  poster_v: string | null;
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

// Compact, stable token for a poster file key (djb2 → base36). Changes whenever
// the poster_key changes (a new cover frame writes a new key), so the grid's
// poster URL changes and the cache-first service worker fetches the new image.
function posterVersion(key: string): string {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
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
  allow18 = false,
  // Linked-group scope: extra profile ids / owner ids unioned with the single
  // profileId/ownerId above, so a non-destructively linked person's clips from
  // every member profile show on one unified profile.
  profileIds: number[] = [],
  ownerIds: number[] = [],
  // Backward pagination: fetch the clips immediately NEWER than this id (the
  // feed opened mid-list from a grid tile and the user scrolls up). Mutually
  // exclusive with cursor. Items are still returned newest-first.
  after: number | null = null,
  // Hashtag scope: only clips whose caption contains #tag (case-insensitive).
  tag: string | null = null,
  // Feed ordering mode. "new" (default) = newest first with id-cursor
  // pagination; "following" = newest first, scoped to followed profiles/users;
  // "liked" = newest first, scoped to clips the viewer liked; "foryou" =
  // engagement-weighted with a seeded shuffle; "random" = seeded shuffle.
  // foryou/random paginate by OFFSET (cursor doubles as the offset — a seeded
  // order has no monotone id to cut on).
  sort: ShortsSort = "new",
  seed = 0,
  // Mention scope: clip ids whose caption @mentions this person (or an alias),
  // unioned with the profile/owner scope so a tagged clip surfaces on the
  // tagged person's profile too — even though it was imported under a different
  // creator profile.
  mentionedIds: number[] = [],
  // Clip-length scope: "short" / "long" split at SHORT_MAX_SECONDS, "all" (the
  // default) leaves the length alone.
  length: ShortsLength = "all"
): { items: FeedShort[]; nextCursor: number | null } {
  const offsetMode = sort === "foryou" || sort === "random";
  // Keep the seed inside SQLite's integer math comfort zone.
  const s32 = Math.abs(Math.floor(seed)) % 2147483647;
  const profIds = profileId !== null ? [profileId, ...profileIds] : [...profileIds];
  const ownIds = ownerId !== null ? [ownerId, ...ownerIds] : [...ownerIds];
  const mentIds = [...mentionedIds];
  // Following scope resolved once (only when needed) — the followed profile +
  // uploader ids for this viewer on this channel, expanded via the person graph.
  const followScope =
    sort === "following"
      ? followedShortsScope(viewerId, channel)
      : { profileIds: [] as number[], userIds: [] as number[] };
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
      "s.source",
      "s.source_id",
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
    .$if(profIds.length > 0 || ownIds.length > 0 || mentIds.length > 0, (q) =>
      q.where((eb) =>
        eb.or(
          [
            profIds.length ? eb("s.profile_id", "in", profIds) : null,
            ownIds.length ? eb("s.uploader_id", "in", ownIds) : null,
            mentIds.length ? eb("s.id", "in", mentIds) : null,
          ].filter((c): c is NonNullable<typeof c> => c !== null)
        )
      )
    )
    // Constrain the channel for plain channel browsing AND for owner scope (so an
    // uploader's 18+ clips don't leak into their main grid). A creator-profile-only
    // scope derives the channel from the profile, so it's skipped there.
    .$if(
      (profIds.length === 0 && playlistId === null) || ownIds.length > 0,
      (q) => q.where("s.channel", "=", channel)
    )
    .$if(category !== null, (q) => q.where("s.category", "=", category!))
    // Clip length. An unprobed clip (duration NULL) is not silently sorted into
    // either side — SQLite's NULL comparison drops it from both, which is the
    // honest answer to "is this one short?".
    .$if(length === "short", (q) =>
      q.where("s.duration", "<=", SHORT_MAX_SECONDS)
    )
    .$if(length === "long", (q) => q.where("s.duration", ">", SHORT_MAX_SECONDS))
    // Hashtag scope: caption contains "#tag". Matches the hashtag followed by a
    // word boundary (a trailing space is appended so an end-of-caption tag also
    // matches) so #cat doesn't also surface #caturday. LIKE instead of GLOB's
    // negated char class, which is ASCII-only and let non-ASCII separators
    // (e.g. "é") through as if they were boundaries (#cat matching #catégorie).
    // The tag is pre-filtered to \p{L}\p{N}_ (no "%"), so only "_" — LIKE's
    // single-char wildcard — needs escaping to stay an exact match.
    .$if(tag !== null, (q) =>
      q.where(
        sql<boolean>`lower(s.caption) || ' ' LIKE ${"%#" + tag!.toLowerCase().replace(/_/g, "\\_") + " %"} ESCAPE '\\'`
      )
    )
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
    // Liked mode: only clips the viewer has liked. Newest-liked-first is close
    // enough to newest-first (id desc) for a personal library, so it keeps the
    // id-cursor pagination — no offset mode needed.
    .$if(sort === "liked", (q) =>
      q.where(
        "s.id",
        "in",
        qb
          .selectFrom("short_likes")
          .select("short_id")
          .where("user_id", "=", viewerId)
      )
    )
    // Following mode: clips from any shorts profile or uploader the viewer
    // follows on this channel — resolved through the unified-person graph (see
    // followedShortsScope), so a follow made on /people (creator/user) counts
    // too, not just a follow made on the shorts profile page. An empty scope
    // matches nothing (never falls through to channel-wide browsing).
    .$if(sort === "following", (q) =>
      followScope.profileIds.length === 0 && followScope.userIds.length === 0
        ? q.where(sql<boolean>`1 = 0`)
        : q.where((eb) =>
            eb.or(
              [
                followScope.profileIds.length
                  ? eb("s.profile_id", "in", followScope.profileIds)
                  : null,
                followScope.userIds.length
                  ? eb("s.uploader_id", "in", followScope.userIds)
                  : null,
              ].filter((c): c is NonNullable<typeof c> => c !== null)
            )
          )
    )
    // Cursor cut / backward mode only make sense for id-ordered feeds; the
    // seeded orders paginate by offset instead.
    .$if(!offsetMode && cursor !== null, (q) => q.where("s.id", "<", cursor!))
    // Backward mode: ascending picks the ids immediately above `after` (not the
    // newest overall); the page is flipped back to newest-first below.
    .$if(!offsetMode && after !== null, (q) => q.where("s.id", ">", after!))
    // A deterministic per-seed shuffle: SQLite has no seeded RANDOM(), so an
    // LCG-style hash of the id gives a stable order for one seed and a fresh
    // one for the next visit. "For you" weighs engagement on top of it.
    .$if(sort === "random", (q) =>
      q.orderBy(sql`((s.id * 1103515245 + ${s32}) % 2147483647)`)
    )
    .$if(sort === "foryou", (q) =>
      q.orderBy(
        sql`(
          (SELECT COUNT(*) FROM short_likes l2 WHERE l2.short_id = s.id) * 40
          + (SELECT COUNT(*) FROM short_comments c2 WHERE c2.short_id = s.id) * 25
          + (((s.id * 1103515245 + ${s32}) % 97) + 97) % 97
        ) DESC`
      )
    )
    .orderBy("s.id", after !== null ? "asc" : "desc")
    .$if(offsetMode, (q) => q.offset(Math.max(0, cursor ?? 0)))
    .limit(limit + 1);

  const rows = getAll<FeedRow>(query);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  // In backward mode nextCursor is the id to pass as the NEXT `after` (the
  // newest id in this page); compute it before the flip to newest-first.
  const pageEndId = page.length ? page[page.length - 1].id : null;
  if (after !== null) page.reverse();

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
    source: r.source,
    source_id: r.source_id,
    like_count: Number(r.like_count),
    comment_count: Number(r.comment_count),
    viewer_liked: Boolean(r.viewer_liked),
    viewer_saved: Boolean(r.viewer_saved),
    has_poster: Boolean(r.poster_key),
    poster_v: r.poster_key ? posterVersion(r.poster_key) : null,
    is_private: Boolean(r.is_private),
  }));

  // Offset mode: the "cursor" is simply where the next page starts.
  const nextCursor = hasMore
    ? offsetMode
      ? Math.max(0, cursor ?? 0) + page.length
      : pageEndId
    : null;
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
  // Reads before it writes: BEGIN IMMEDIATE so busy_timeout applies (see lib/db.ts).
  tx.immediate();
  return { reassigned, merged };
}

// ---------------------------------------------------------------------------
// Hashtags as categories.
//
// Shorts keep their tags inside the caption (unlike posts, which have a
// post_hashtags table), so the catalogue is derived rather than stored: every
// caption on the channel is read and its #tags counted. That is a few thousand
// short strings — cheap enough per request, and it can never drift from what
// the captions actually say, which a materialised table would.

export interface ShortTagSummary {
  tag: string;
  count: number;
  // Newest clip carrying the tag that has a poster — the category's cover.
  coverId: number | null;
  coverV: string | null;
}

export function getShortTags(
  channel: ShortChannel,
  viewerId: number,
  isAdmin = false
): ShortTagSummary[] {
  const rows = getAll<{
    id: number;
    caption: string | null;
    poster_key: string | null;
  }>(
    qb
      .selectFrom("shorts as s")
      .select(["s.id", "s.caption", "s.poster_key"])
      .where("s.is_deleted", "=", 0)
      .where("s.status", "=", "ready")
      .where("s.channel", "=", channel)
      // Only captions that can carry a tag at all.
      .where("s.caption", "like", "%#%")
      // Same privacy rule as the feed: others' private clips stay invisible,
      // so a tag only used by one cannot be counted or named here either.
      .$if(!isAdmin, (q) =>
        q.where((eb) =>
          eb.or([eb("s.is_private", "=", 0), eb("s.uploader_id", "=", viewerId)])
        )
      )
      // Newest first, so the first clip seen for a tag becomes its cover.
      .orderBy("s.id", "desc")
  );

  const byTag = new Map<string, ShortTagSummary>();
  for (const r of rows) {
    // splitCaption's rules, inlined: strip the trailing "Source: <url>" first
    // so a fragment in the URL never reads as a hashtag.
    const stripped = (r.caption ?? "").replace(
      /(?:^|\s)Source:\s*(https?:\/\/\S+)/i,
      " "
    );
    const seen = new Set<string>();
    for (const m of stripped.matchAll(/#([\p{L}\p{N}_]+)/gu)) {
      const tag = m[1].toLowerCase();
      if (seen.has(tag)) continue; // one clip counts once per tag
      seen.add(tag);
      const entry = byTag.get(tag);
      if (entry) {
        entry.count++;
        if (entry.coverId === null && r.poster_key) {
          entry.coverId = r.id;
          entry.coverV = posterVersion(r.poster_key);
        }
      } else {
        byTag.set(tag, {
          tag,
          count: 1,
          coverId: r.poster_key ? r.id : null,
          coverV: r.poster_key ? posterVersion(r.poster_key) : null,
        });
      }
    }
  }

  return [...byTag.values()].sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag)
  );
}
