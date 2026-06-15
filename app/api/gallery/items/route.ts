import { NextResponse } from "next/server";
import { db, GalleryItemRow } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// List the current user's items for a given tab, newest first.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = Number(session.sub);
  const tab = new URL(request.url).searchParams.get("tab") || "photos";

  let where = "user_id = ? AND is_deleted = 0";
  if (tab === "favorites") where = "user_id = ? AND is_deleted = 0 AND is_favorite = 1";
  else if (tab === "trash") where = "user_id = ? AND is_deleted = 1";

  const rows = db
    .prepare(
      `SELECT id, filename, mime_type, width, height, latitude, longitude,
              location_name, media_version, taken_at, is_favorite, is_deleted
       FROM gallery_items
       WHERE ${where}
       ORDER BY taken_at DESC, id DESC`
    )
    .all(userId) as Partial<GalleryItemRow>[];

  return NextResponse.json({ items: rows });
}
