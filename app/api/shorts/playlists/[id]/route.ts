import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

interface PlaylistRow {
  id: number;
  user_id: number;
  name: string;
  created_at: string;
}

function ownedPlaylist(id: number, userId: number): PlaylistRow | undefined {
  return db
    .prepare("SELECT * FROM short_playlists WHERE id = ? AND user_id = ?")
    .get(id, userId) as PlaylistRow | undefined;
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const pl = ownedPlaylist(Number(params.id), Number(session.sub));
  if (!pl) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const count = (
    db
      .prepare("SELECT COUNT(*) AS n FROM short_playlist_items WHERE playlist_id = ?")
      .get(pl.id) as { n: number }
  ).n;

  return NextResponse.json({ playlist: { id: pl.id, name: pl.name, item_count: count } });
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const pl = ownedPlaylist(Number(params.id), Number(session.sub));
  if (!pl) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  if (!name) {
    return NextResponse.json({ error: "A name is required." }, { status: 400 });
  }

  db.prepare("UPDATE short_playlists SET name = ? WHERE id = ?").run(name, pl.id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const pl = ownedPlaylist(Number(params.id), Number(session.sub));
  if (!pl) return NextResponse.json({ error: "Not found" }, { status: 404 });

  db.prepare("DELETE FROM short_playlists WHERE id = ?").run(pl.id);
  return NextResponse.json({ ok: true });
}
