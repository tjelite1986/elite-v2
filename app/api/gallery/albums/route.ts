import { NextResponse } from "next/server";
import { sql } from "kysely";
import { db } from "@/lib/db";
import { qb, getAll } from "@/lib/kysely";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// List the user's albums with item counts and a cover (latest item).
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = Number(session.sub);

  const albums = getAll(
    qb
      .selectFrom("gallery_albums as a")
      .select([
        "a.id",
        "a.name",
        "a.created_at",
        sql<number>`(SELECT COUNT(*) FROM gallery_album_items ai JOIN gallery_items gi ON gi.id = ai.item_id WHERE ai.album_id = a.id AND gi.is_deleted = 0)`.as(
          "item_count"
        ),
        sql<number | null>`(SELECT ai.item_id FROM gallery_album_items ai JOIN gallery_items gi ON gi.id = ai.item_id WHERE ai.album_id = a.id AND gi.is_deleted = 0 ORDER BY gi.taken_at DESC LIMIT 1)`.as(
          "cover_id"
        ),
        sql<number | null>`(SELECT gi.media_version FROM gallery_album_items ai JOIN gallery_items gi ON gi.id = ai.item_id WHERE ai.album_id = a.id AND gi.is_deleted = 0 ORDER BY gi.taken_at DESC LIMIT 1)`.as(
          "cover_version"
        ),
      ])
      .where("a.user_id", "=", userId)
      .orderBy("a.created_at", "desc")
  );

  return NextResponse.json({ albums });
}

// Create an album.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = Number(session.sub);

  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  if (!name) {
    return NextResponse.json({ error: "Album name is required." }, { status: 400 });
  }

  const result = db
    .prepare("INSERT INTO gallery_albums (user_id, name) VALUES (?, ?)")
    .run(userId, name.slice(0, 120));

  return NextResponse.json({ ok: true, id: Number(result.lastInsertRowid) });
}
