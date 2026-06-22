import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { qb, getOne, getAll } from "@/lib/kysely";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

function ownsAlbum(albumId: number, userId: number): boolean {
  return !!getOne(
    qb
      .selectFrom("gallery_albums")
      .select("id")
      .where("id", "=", albumId)
      .where("user_id", "=", userId)
  );
}

function parseIds(body: { ids?: unknown }): number[] {
  return Array.isArray(body.ids)
    ? body.ids.map((n) => Number(n)).filter((n) => Number.isInteger(n))
    : [];
}

// Add the user's items to an album (ignores items they don't own / already in).
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = Number(session.sub);
  const albumId = Number(params.id);
  if (!ownsAlbum(albumId, userId))
    return NextResponse.json({ error: "Not found." }, { status: 404 });

  const ids = parseIds(await request.json().catch(() => ({})));
  if (ids.length === 0)
    return NextResponse.json({ error: "No items selected." }, { status: 400 });

  const owned = getAll<{ id: number }>(
    qb
      .selectFrom("gallery_items")
      .select("id")
      .where("user_id", "=", userId)
      .where("id", "in", ids)
  ).map((r) => r.id);

  const insert = db.prepare(
    "INSERT OR IGNORE INTO gallery_album_items (album_id, item_id) VALUES (?, ?)"
  );
  const run = db.transaction(() => {
    for (const id of owned) insert.run(albumId, id);
  });
  run();

  return NextResponse.json({ ok: true, added: owned.length });
}

// Remove items from an album (does not delete the photos).
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = Number(session.sub);
  const albumId = Number(params.id);
  if (!ownsAlbum(albumId, userId))
    return NextResponse.json({ error: "Not found." }, { status: 404 });

  const ids = parseIds(await request.json().catch(() => ({})));
  if (ids.length === 0)
    return NextResponse.json({ error: "No items selected." }, { status: 400 });

  const placeholders = ids.map(() => "?").join(",");
  db.prepare(
    `DELETE FROM gallery_album_items WHERE album_id = ? AND item_id IN (${placeholders})`
  ).run(albumId, ...ids);

  return NextResponse.json({ ok: true });
}
