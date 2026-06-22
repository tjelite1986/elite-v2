import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { qb, getOne } from "@/lib/kysely";

export const dynamic = "force-dynamic";

function ownsPlaylist(id: number, userId: number): boolean {
  return !!getOne(
    qb
      .selectFrom("short_playlists")
      .select("id")
      .where("id", "=", id)
      .where("user_id", "=", userId)
  );
}

// Add a clip to the playlist.
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const playlistId = Number(params.id);
  if (!ownsPlaylist(playlistId, Number(session.sub))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const shortId = Number(body.shortId);
  if (!shortId) {
    return NextResponse.json({ error: "shortId is required." }, { status: 400 });
  }
  const exists = getOne(
    qb.selectFrom("shorts").select("id").where("id", "=", shortId).where("is_deleted", "=", 0)
  );
  if (!exists) {
    return NextResponse.json({ error: "Clip not found." }, { status: 404 });
  }

  db.prepare(
    `INSERT INTO short_playlist_items (playlist_id, short_id) VALUES (?, ?)
     ON CONFLICT(playlist_id, short_id) DO NOTHING`
  ).run(playlistId, shortId);

  return NextResponse.json({ ok: true, added: true });
}

// Remove a clip from the playlist (?short=<id>).
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const playlistId = Number(params.id);
  if (!ownsPlaylist(playlistId, Number(session.sub))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const shortId = Number(new URL(request.url).searchParams.get("short"));
  if (!shortId) {
    return NextResponse.json({ error: "short is required." }, { status: 400 });
  }

  db.prepare(
    "DELETE FROM short_playlist_items WHERE playlist_id = ? AND short_id = ?"
  ).run(playlistId, shortId);

  return NextResponse.json({ ok: true, added: false });
}
