import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// "On This Day": the user's photos taken on today's month+day in earlier years.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const items = db
    .prepare(
      `SELECT id, filename, mime_type, width, height, latitude, longitude,
              location_name, camera, media_version, taken_at, is_favorite,
              rating, is_deleted
       FROM gallery_items
       WHERE user_id = ?
         AND is_deleted = 0
         AND strftime('%m-%d', taken_at) = strftime('%m-%d', 'now', 'localtime')
         AND strftime('%Y', taken_at) < strftime('%Y', 'now', 'localtime')
       ORDER BY taken_at DESC, id DESC`
    )
    .all(Number(session.sub));
  return NextResponse.json({ items });
}
