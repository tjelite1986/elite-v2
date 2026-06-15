import { NextResponse } from "next/server";
import { db, GalleryAlbumRow } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

function getOwnedAlbum(id: number, userId: number): GalleryAlbumRow | undefined {
  return db
    .prepare("SELECT * FROM gallery_albums WHERE id = ? AND user_id = ?")
    .get(id, userId) as GalleryAlbumRow | undefined;
}

// Album detail + its (non-deleted) items, newest first.
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = Number(session.sub);

  const album = getOwnedAlbum(Number(params.id), userId);
  if (!album) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const items = db
    .prepare(
      `SELECT gi.id, gi.filename, gi.mime_type, gi.width, gi.height,
              gi.latitude, gi.longitude, gi.location_name, gi.media_version,
              gi.taken_at, gi.is_favorite, gi.is_deleted
       FROM gallery_album_items ai
       JOIN gallery_items gi ON gi.id = ai.item_id
       WHERE ai.album_id = ? AND gi.is_deleted = 0
       ORDER BY gi.taken_at DESC, gi.id DESC`
    )
    .all(album.id);

  return NextResponse.json({ album, items });
}

// Rename an album.
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = Number(session.sub);

  const album = getOwnedAlbum(Number(params.id), userId);
  if (!album) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  if (!name) return NextResponse.json({ error: "Name is required." }, { status: 400 });

  db.prepare("UPDATE gallery_albums SET name = ? WHERE id = ?").run(
    name.slice(0, 120),
    album.id
  );
  return NextResponse.json({ ok: true });
}

// Delete an album (its membership rows cascade; photos are untouched).
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = Number(session.sub);

  const album = getOwnedAlbum(Number(params.id), userId);
  if (!album) return NextResponse.json({ error: "Not found." }, { status: 404 });

  db.prepare("DELETE FROM gallery_albums WHERE id = ?").run(album.id);
  return NextResponse.json({ ok: true });
}
