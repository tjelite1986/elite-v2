import { NextResponse } from "next/server";
import { sql } from "kysely";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { qb, getOne, getAll } from "@/lib/kysely";

export const dynamic = "force-dynamic";

interface PlaylistCard {
  id: number;
  name: string;
  created_at: string;
  item_count: number;
  cover_id: number | null;
  contains?: number;
}

// The signed-in user's playlists ("Favorites"), with a cover thumbnail + count.
// With ?short=<id>, each playlist also reports whether it already contains that
// clip — used by the save-to-playlist picker on the feed.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = Number(session.sub);
  const shortRaw = new URL(request.url).searchParams.get("short");
  const shortId = shortRaw && !isNaN(Number(shortRaw)) ? Number(shortRaw) : null;

  const playlists = getAll<PlaylistCard>(
    qb
      .selectFrom("short_playlists as pl")
      .leftJoin("short_playlist_items as pi", "pi.playlist_id", "pl.id")
      .select([
        "pl.id",
        "pl.name",
        "pl.created_at",
        sql<number>`COUNT(pi.short_id)`.as("item_count"),
        sql<number | null>`(SELECT pi2.short_id FROM short_playlist_items pi2 JOIN shorts s ON s.id = pi2.short_id WHERE pi2.playlist_id = pl.id AND s.is_deleted = 0 ORDER BY pi2.added_at DESC LIMIT 1)`.as(
          "cover_id"
        ),
        sql<number>`EXISTS(SELECT 1 FROM short_playlist_items pc WHERE pc.playlist_id = pl.id AND pc.short_id = ${shortId})`.as(
          "contains"
        ),
      ])
      .where("pl.user_id", "=", userId)
      .groupBy("pl.id")
      .orderBy("pl.created_at", "desc")
  );

  return NextResponse.json({ playlists });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = Number(session.sub);

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  if (!name) {
    return NextResponse.json({ error: "A name is required." }, { status: 400 });
  }

  const result = db
    .prepare("INSERT INTO short_playlists (user_id, name) VALUES (?, ?)")
    .run(userId, name);

  const playlist = getOne(
    qb
      .selectFrom("short_playlists")
      .selectAll()
      .where("id", "=", Number(result.lastInsertRowid))
  );

  return NextResponse.json({ ok: true, playlist });
}
