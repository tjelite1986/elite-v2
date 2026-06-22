import { sql } from "kysely";
import { db, StoryRow } from "./db";
import { qb, getOne, getAll } from "./kysely";

// Ephemeral 24h stories (users only in v1). Grouped per author for the rail; the
// viewer sees their own plus the people they follow.

export interface StoryItem {
  id: number;
  viewed: boolean;
}

export interface StoryGroup {
  userId: number;
  username: string;
  avatar_key: string | null;
  isSelf: boolean;
  allViewed: boolean;
  stories: StoryItem[];
}

interface StoryQueryRow {
  id: number;
  author_user_id: number;
  username: string;
  avatar_key: string | null;
  viewed: number;
}

// Active (non-expired) stories from the viewer + the users they follow, grouped
// by author. The viewer's own group is sorted first, then authors with unseen
// stories, then the rest.
export function getActiveStoryGroups(viewerId: number): StoryGroup[] {
  const rows = getAll<StoryQueryRow>(
    qb
      .selectFrom("stories as s")
      .innerJoin("user_profiles as up", "up.user_id", "s.author_user_id")
      .select([
        "s.id",
        "s.author_user_id",
        "up.username",
        "up.avatar_key",
        sql<number>`EXISTS(SELECT 1 FROM story_views v WHERE v.story_id = s.id AND v.user_id = ${viewerId})`.as(
          "viewed"
        ),
      ])
      .where("s.expires_at", ">", sql<string>`datetime('now')`)
      .where((eb) =>
        eb.or([
          eb("s.author_user_id", "=", viewerId),
          eb(
            "s.author_user_id",
            "in",
            qb
              .selectFrom("follows")
              .select("target_id")
              .where("follower_id", "=", viewerId)
              .where("target_type", "=", "user")
          ),
        ])
      )
      .orderBy("s.author_user_id")
      .orderBy("s.id")
  );

  const byAuthor = new Map<number, StoryGroup>();
  for (const r of rows) {
    let g = byAuthor.get(r.author_user_id);
    if (!g) {
      g = {
        userId: r.author_user_id,
        username: r.username,
        avatar_key: r.avatar_key,
        isSelf: r.author_user_id === viewerId,
        allViewed: true,
        stories: [],
      };
      byAuthor.set(r.author_user_id, g);
    }
    const viewed = Boolean(r.viewed);
    g.stories.push({ id: r.id, viewed });
    if (!viewed) g.allViewed = false;
  }

  return Array.from(byAuthor.values()).sort((a, b) => {
    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
    if (a.allViewed !== b.allViewed) return a.allViewed ? 1 : -1;
    return b.userId - a.userId;
  });
}

export function createStory(
  authorUserId: number,
  storageKey: string,
  mimeType: string
): number {
  const res = db
    .prepare(
      `INSERT INTO stories (author_user_id, storage_key, mime_type, expires_at)
       VALUES (?, ?, ?, datetime('now', '+1 day'))`
    )
    .run(authorUserId, storageKey, mimeType);
  return Number(res.lastInsertRowid);
}

export function getStory(id: number): StoryRow | undefined {
  return getOne<StoryRow>(
    qb
      .selectFrom("stories")
      .selectAll()
      .where("id", "=", id)
      .where("expires_at", ">", sql<string>`datetime('now')`)
  );
}

export function markStoryViewed(storyId: number, userId: number): void {
  db.prepare(
    "INSERT OR IGNORE INTO story_views (story_id, user_id) VALUES (?, ?)"
  ).run(storyId, userId);
}
