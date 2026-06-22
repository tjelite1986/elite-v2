import { sql } from "kysely";
import { PostRow } from "./db";
import { qb, getOne, getAll } from "./kysely";

// Query layer for the posts module. Author of a post is a real user OR a
// mirrored creator; every query resolves a unified author shape by joining both
// profile tables and coalescing.

export type AuthorType = "user" | "creator";

export interface FeedAuthor {
  type: AuthorType;
  id: number; // user_id or creator id
  username: string | null;
  display_name: string | null;
  avatar_key: string | null;
}

export interface FeedPostMedia {
  id: number;
  width: number | null;
  height: number | null;
}

export interface FeedPost {
  id: number;
  caption: string | null;
  is_adult: boolean;
  created_at: string;
  author: FeedAuthor;
  media: FeedPostMedia[];
  like_count: number;
  comment_count: number;
  viewer_liked: boolean;
}

interface PostQueryRow extends PostRow {
  author_username: string | null;
  author_display_name: string | null;
  author_avatar_key: string | null;
  author_type: AuthorType;
  author_id: number;
  like_count: number;
  comment_count: number;
  viewer_liked: number;
}

// Shared base: posts joined to both author tables, with the coalesced author
// shape, like/comment counts and viewer-liked flag. Equivalent to the old
// POST_SELECT string — the polymorphic COALESCE/CASE columns stay as sql``
// fragments (the builder has no native COALESCE-across-joins), while the joins,
// filters, ordering and pagination become type-checked builder calls.
function postBase(viewerId: number) {
  return qb
    .selectFrom("posts as p")
    .leftJoin("user_profiles as up", "up.user_id", "p.author_user_id")
    .leftJoin("post_creators as pc", "pc.id", "p.author_creator_id")
    .selectAll("p")
    .select([
      sql<string | null>`COALESCE(up.username, pc.username)`.as(
        "author_username"
      ),
      sql<string | null>`COALESCE(up.display_name, pc.display_name)`.as(
        "author_display_name"
      ),
      sql<string | null>`COALESCE(up.avatar_key, pc.avatar_key)`.as(
        "author_avatar_key"
      ),
      sql<AuthorType>`CASE WHEN p.author_user_id IS NOT NULL THEN 'user' ELSE 'creator' END`.as(
        "author_type"
      ),
      sql<number>`COALESCE(p.author_user_id, p.author_creator_id)`.as(
        "author_id"
      ),
      sql<number>`(SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id)`.as(
        "like_count"
      ),
      sql<number>`(SELECT COUNT(*) FROM post_comments c WHERE c.post_id = p.id)`.as(
        "comment_count"
      ),
      sql<number>`EXISTS(SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.user_id = ${viewerId})`.as(
        "viewer_liked"
      ),
    ]);
}

function attachMedia(rows: PostQueryRow[]): FeedPost[] {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const media = getAll<{
    id: number;
    post_id: number;
    width: number | null;
    height: number | null;
  }>(
    qb
      .selectFrom("post_media")
      .select(["id", "post_id", "width", "height"])
      .where("post_id", "in", ids)
      .orderBy("post_id")
      .orderBy("position")
      .orderBy("id")
  );
  const byPost = new Map<number, FeedPostMedia[]>();
  for (const m of media) {
    if (!byPost.has(m.post_id)) byPost.set(m.post_id, []);
    byPost.get(m.post_id)!.push({ id: m.id, width: m.width, height: m.height });
  }
  return rows.map((r) => ({
    id: r.id,
    caption: r.caption,
    is_adult: Boolean(r.is_adult),
    created_at: r.created_at,
    author: {
      type: r.author_type,
      id: r.author_id,
      username: r.author_username,
      display_name: r.author_display_name,
      avatar_key: r.author_avatar_key,
    },
    media: byPost.get(r.id) ?? [],
    like_count: Number(r.like_count),
    comment_count: Number(r.comment_count),
    viewer_liked: Boolean(r.viewer_liked),
  }));
}

export type FeedScope =
  | { kind: "home" }
  | { kind: "explore" }
  | { kind: "user"; userId: number }
  | { kind: "creator"; creatorId: number }
  | { kind: "person"; userId: number | null; creatorId: number | null }
  | { kind: "tag"; tag: string };

// Cursor-paginated feed (newest first; cursor = last post id seen). Adult posts
// are excluded unless includeAdult (the caller gates the 18+ PIN).
export function getFeed(
  scope: FeedScope,
  viewerId: number,
  cursor: number | null,
  limit = 12,
  includeAdult = false
): { items: FeedPost[]; nextCursor: number | null } {
  let q = postBase(viewerId).where("p.is_deleted", "=", 0);

  if (!includeAdult) q = q.where("p.is_adult", "=", 0);
  if (cursor) q = q.where("p.id", "<", cursor);

  switch (scope.kind) {
    case "home":
      q = q.where((eb) =>
        eb.or([
          eb(
            "p.author_user_id",
            "in",
            qb
              .selectFrom("follows")
              .select("target_id")
              .where("follower_id", "=", viewerId)
              .where("target_type", "=", "user")
          ),
          eb(
            "p.author_creator_id",
            "in",
            qb
              .selectFrom("follows")
              .select("target_id")
              .where("follower_id", "=", viewerId)
              .where("target_type", "=", "creator")
          ),
          eb("p.author_user_id", "=", viewerId),
        ])
      );
      break;
    case "explore":
      break;
    case "user":
      q = q.where("p.author_user_id", "=", scope.userId);
      break;
    case "creator":
      q = q.where("p.author_creator_id", "=", scope.creatorId);
      break;
    case "person":
      // Union of a handle's user-authored and creator-authored posts.
      q = q.where((eb) =>
        eb.or([
          eb("p.author_user_id", "=", scope.userId),
          eb("p.author_creator_id", "=", scope.creatorId),
        ])
      );
      break;
    case "tag":
      // A post carries each tag at most once (PK on post_id,tag), so an IN
      // subquery is equivalent to the old JOIN without changing row counts.
      q = q.where(
        "p.id",
        "in",
        qb
          .selectFrom("post_hashtags")
          .select("post_id")
          .where("tag", "=", scope.tag.toLowerCase())
      );
      break;
  }

  const rows = getAll<PostQueryRow>(
    q.orderBy("p.id", "desc").limit(limit + 1)
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: attachMedia(page),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

export function getPost(id: number, viewerId: number): FeedPost | undefined {
  const row = getOne<PostQueryRow>(
    postBase(viewerId).where("p.id", "=", id).where("p.is_deleted", "=", 0)
  );
  if (!row) return undefined;
  return attachMedia([row])[0];
}

// Bare row (no joins) for ownership/gate checks in mutating routes.
export function getPostRow(id: number): PostRow | undefined {
  return getOne<PostRow>(
    qb
      .selectFrom("posts")
      .selectAll()
      .where("id", "=", id)
      .where("is_deleted", "=", 0)
  );
}

// Extract unique lowercase #hashtags from a caption.
export function parseHashtags(caption: string | null): string[] {
  if (!caption) return [];
  const tags: string[] = [];
  const re = /#([a-z0-9_]{1,50})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(caption)) !== null) {
    const tag = m[1].toLowerCase();
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

export function isFollowing(
  followerId: number,
  targetType: AuthorType,
  targetId: number
): boolean {
  return (
    getOne(
      qb
        .selectFrom("follows")
        .select("follower_id")
        .where("follower_id", "=", followerId)
        .where("target_type", "=", targetType)
        .where("target_id", "=", targetId)
    ) !== undefined
  );
}

export function followerCount(targetType: AuthorType, targetId: number): number {
  const r = getOne<{ c: number }>(
    qb
      .selectFrom("follows")
      .select((eb) => eb.fn.countAll<number>().as("c"))
      .where("target_type", "=", targetType)
      .where("target_id", "=", targetId)
  );
  return r?.c ?? 0;
}

export function followingCount(userId: number): number {
  const r = getOne<{ c: number }>(
    qb
      .selectFrom("follows")
      .select((eb) => eb.fn.countAll<number>().as("c"))
      .where("follower_id", "=", userId)
  );
  return r?.c ?? 0;
}

export function postCountForUser(userId: number): number {
  const r = getOne<{ c: number }>(
    qb
      .selectFrom("posts")
      .select((eb) => eb.fn.countAll<number>().as("c"))
      .where("author_user_id", "=", userId)
      .where("is_deleted", "=", 0)
  );
  return r?.c ?? 0;
}

export function postCountForCreator(creatorId: number): number {
  const r = getOne<{ c: number }>(
    qb
      .selectFrom("posts")
      .select((eb) => eb.fn.countAll<number>().as("c"))
      .where("author_creator_id", "=", creatorId)
      .where("is_deleted", "=", 0)
  );
  return r?.c ?? 0;
}
