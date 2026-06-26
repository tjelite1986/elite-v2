import { NextResponse } from "next/server";
import { GalleryItemRow } from "@/lib/db";
import { qb, getAll } from "@/lib/kysely";
import { getSession } from "@/lib/auth";
import { itemIdsByTag } from "@/lib/gallery-tags";

export const dynamic = "force-dynamic";

// List the current user's items for a given tab, newest first.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = Number(session.sub);
  const url = new URL(request.url);
  const tab = url.searchParams.get("tab") || "photos";
  const tag = url.searchParams.get("tag");

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
      "camera",
      "media_version",
      "taken_at",
      "is_favorite",
      "rating",
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

  // Optional tag filter (over the current tab's non-trashed scope).
  if (tag) {
    const ids = itemIdsByTag(userId, tag);
    if (ids.length === 0) return NextResponse.json({ items: [] });
    q = q.where("id", "in", ids);
  }

  const rows = getAll<Partial<GalleryItemRow>>(
    q.orderBy("taken_at", "desc").orderBy("id", "desc")
  );

  return NextResponse.json({ items: rows });
}
