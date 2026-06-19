import { db, PostRow } from "./db";

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

const POST_SELECT = `
  SELECT p.*,
         COALESCE(up.username, pc.username)         AS author_username,
         COALESCE(up.display_name, pc.display_name) AS author_display_name,
         COALESCE(up.avatar_key, pc.avatar_key)     AS author_avatar_key,
         CASE WHEN p.author_user_id IS NOT NULL THEN 'user' ELSE 'creator' END AS author_type,
         COALESCE(p.author_user_id, p.author_creator_id) AS author_id,
         (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id)    AS like_count,
         (SELECT COUNT(*) FROM post_comments c WHERE c.post_id = p.id) AS comment_count,
         EXISTS(SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.user_id = @viewer) AS viewer_liked
    FROM posts p
    LEFT JOIN user_profiles up ON up.user_id = p.author_user_id
    LEFT JOIN post_creators  pc ON pc.id      = p.author_creator_id
`;

function attachMedia(rows: PostQueryRow[]): FeedPost[] {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");
  const media = db
    .prepare(
      `SELECT id, post_id, width, height FROM post_media
        WHERE post_id IN (${placeholders}) ORDER BY post_id, position, id`
    )
    .all(...ids) as { id: number; post_id: number; width: number | null; height: number | null }[];
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
  const where: string[] = ["p.is_deleted = 0"];
  const params: Record<string, unknown> = { viewer: viewerId, limit: limit + 1 };

  if (!includeAdult) where.push("p.is_adult = 0");
  if (cursor) {
    where.push("p.id < @cursor");
    params.cursor = cursor;
  }

  let from = POST_SELECT;
  switch (scope.kind) {
    case "home":
      where.push(`(
        p.author_user_id IN (SELECT target_id FROM follows WHERE follower_id = @viewer AND target_type = 'user')
        OR p.author_creator_id IN (SELECT target_id FROM follows WHERE follower_id = @viewer AND target_type = 'creator')
        OR p.author_user_id = @viewer
      )`);
      break;
    case "explore":
      break;
    case "user":
      where.push("p.author_user_id = @authorId");
      params.authorId = scope.userId;
      break;
    case "creator":
      where.push("p.author_creator_id = @authorId");
      params.authorId = scope.creatorId;
      break;
    case "tag":
      from += " JOIN post_hashtags ht ON ht.post_id = p.id ";
      where.push("ht.tag = @tag");
      params.tag = scope.tag.toLowerCase();
      break;
  }

  const rows = db
    .prepare(
      `${from} WHERE ${where.join(" AND ")} ORDER BY p.id DESC LIMIT @limit`
    )
    .all(params) as PostQueryRow[];

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: attachMedia(page),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

export function getPost(id: number, viewerId: number): FeedPost | undefined {
  const row = db
    .prepare(`${POST_SELECT} WHERE p.id = @id AND p.is_deleted = 0`)
    .get({ viewer: viewerId, id }) as PostQueryRow | undefined;
  if (!row) return undefined;
  return attachMedia([row])[0];
}

// Bare row (no joins) for ownership/gate checks in mutating routes.
export function getPostRow(id: number): PostRow | undefined {
  return db
    .prepare("SELECT * FROM posts WHERE id = ? AND is_deleted = 0")
    .get(id) as PostRow | undefined;
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
  return Boolean(
    db
      .prepare(
        "SELECT 1 FROM follows WHERE follower_id = ? AND target_type = ? AND target_id = ?"
      )
      .get(followerId, targetType, targetId)
  );
}

export function followerCount(targetType: AuthorType, targetId: number): number {
  return (
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM follows WHERE target_type = ? AND target_id = ?"
      )
      .get(targetType, targetId) as { c: number }
  ).c;
}

export function followingCount(userId: number): number {
  return (
    db
      .prepare("SELECT COUNT(*) AS c FROM follows WHERE follower_id = ?")
      .get(userId) as { c: number }
  ).c;
}

export function postCountForUser(userId: number): number {
  return (
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM posts WHERE author_user_id = ? AND is_deleted = 0"
      )
      .get(userId) as { c: number }
  ).c;
}

export function postCountForCreator(creatorId: number): number {
  return (
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM posts WHERE author_creator_id = ? AND is_deleted = 0"
      )
      .get(creatorId) as { c: number }
  ).c;
}
