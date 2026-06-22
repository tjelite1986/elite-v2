import { NextResponse } from "next/server";
import { GalleryItemRow } from "@/lib/db";
import { qb, getAll } from "@/lib/kysely";
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

  let q = qb
    .selectFrom("gallery_items")
    .select([
      "id",
      "filename",
      "mime_type",
      "width",
      "height",
      "latitude",
      "longitude",
      "location_name",
      "media_version",
      "taken_at",
      "is_favorite",
      "is_deleted",
    ])
    .where("user_id", "=", userId);
  if (tab === "favorites") {
    q = q.where("is_deleted", "=", 0).where("is_favorite", "=", 1);
  } else if (tab === "trash") {
    q = q.where("is_deleted", "=", 1);
  } else {
    q = q.where("is_deleted", "=", 0);
  }

  const rows = getAll<Partial<GalleryItemRow>>(
    q.orderBy("taken_at", "desc").orderBy("id", "desc")
  );

  return NextResponse.json({ items: rows });
}
