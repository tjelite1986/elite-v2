import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

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

  const playlists = db
    .prepare(
      `SELECT pl.id, pl.name, pl.created_at,
              COUNT(pi.short_id) AS item_count,
              (SELECT pi2.short_id FROM short_playlist_items pi2
                 JOIN shorts s ON s.id = pi2.short_id
                WHERE pi2.playlist_id = pl.id AND s.is_deleted = 0
                ORDER BY pi2.added_at DESC LIMIT 1) AS cover_id,
              EXISTS(SELECT 1 FROM short_playlist_items pc
                      WHERE pc.playlist_id = pl.id AND pc.short_id = @short) AS contains
         FROM short_playlists pl
         LEFT JOIN short_playlist_items pi ON pi.playlist_id = pl.id
        WHERE pl.user_id = @user
        GROUP BY pl.id
        ORDER BY pl.created_at DESC`
    )
    .all({ user: userId, short: shortId }) as PlaylistCard[];

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

  const playlist = db
    .prepare("SELECT * FROM short_playlists WHERE id = ?")
    .get(Number(result.lastInsertRowid));

  return NextResponse.json({ ok: true, playlist });
}
