import { NextResponse } from "next/server";
import { sql } from "kysely";
import { qb, getAll } from "@/lib/kysely";
import { getSession } from "@/lib/auth";
import { has18Access } from "@/lib/shorts-gate";

export const dynamic = "force-dynamic";

// "On this day" across the hub: feed posts, the viewer's own gallery photos
// and their own DMs from today's month+day in earlier years. Same date
// convention as /api/gallery/memories (stored timestamps compared as-is).
const SAME_DAY = (col: string) =>
  sql<boolean>`strftime('%m-%d', ${sql.ref(col)}) = strftime('%m-%d', 'now', 'localtime')
    AND strftime('%Y', ${sql.ref(col)}) < strftime('%Y', 'now', 'localtime')`;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const me = Number(session.sub);
  const adult = await has18Access();

  let postsQuery = qb
    .selectFrom("posts as p")
    .leftJoin("post_creators as pc", "pc.id", "p.author_creator_id")
    .leftJoin("user_profiles as up", "up.user_id", "p.author_user_id")
    .select((eb) => [
      "p.id",
      "p.caption",
      "p.created_at",
      sql<string | null>`COALESCE(pc.username, up.username)`.as("author"),
      eb
        .selectFrom("post_media as pm")
        .select("pm.id")
        .whereRef("pm.post_id", "=", "p.id")
        .orderBy("pm.position")
        .limit(1)
        .as("media_id"),
    ])
    .where("p.is_deleted", "=", 0)
    .where(SAME_DAY("p.created_at"))
    .orderBy("p.created_at", "desc")
    .limit(100);
  if (!adult) postsQuery = postsQuery.where("p.is_adult", "=", 0);
  const posts = getAll<{
    id: number;
    caption: string | null;
    created_at: string;
    author: string | null;
    media_id: number | null;
  }>(postsQuery);

  const gallery = getAll<{
    id: number;
    filename: string;
    media_version: number;
    taken_at: string;
  }>(
    qb
      .selectFrom("gallery_items")
      .select(["id", "filename", "media_version", "taken_at"])
      .where("user_id", "=", me)
      .where("is_deleted", "=", 0)
      .where(SAME_DAY("taken_at"))
      .orderBy("taken_at", "desc")
      .limit(100)
  );

  const messages = getAll<{
    id: number;
    body: string;
    created_at: string;
    peer: string;
    mine: number;
  }>(
    qb
      .selectFrom("messages as m")
      .innerJoin("user_profiles as su", "su.user_id", "m.sender_id")
      .innerJoin("user_profiles as ru", "ru.user_id", "m.recipient_id")
      .select([
        "m.id",
        "m.body",
        "m.created_at",
        sql<string>`CASE WHEN m.sender_id = ${me} THEN ru.username ELSE su.username END`.as("peer"),
        sql<number>`CASE WHEN m.sender_id = ${me} THEN 1 ELSE 0 END`.as("mine"),
      ])
      .where((eb) => eb.or([eb("m.sender_id", "=", me), eb("m.recipient_id", "=", me)]))
      .where("m.deleted_at", "is", null)
      .where(SAME_DAY("m.created_at"))
      .orderBy("m.created_at", "desc")
      .limit(50)
  );

  return NextResponse.json({ posts, gallery, messages });
}
