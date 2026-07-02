import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { deleteGalleryDuplicates } from "@/lib/gallery-duplicates";

export const dynamic = "force-dynamic";

// Trash the chosen duplicate items (admin only). Pass { itemIds: number[] }; any
// image may be chosen, but if a whole group is selected its best is auto-kept so
// a group is never wiped whole. Items go to the gallery trash (is_deleted = 1),
// matching how the gallery removes photos everywhere else.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session, "gallery_settings")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const itemIds = Array.isArray(body.itemIds)
    ? body.itemIds.map((n: unknown) => Number(n))
    : [];
  if (itemIds.length === 0) {
    return NextResponse.json({ error: "No images selected." }, { status: 400 });
  }

  const { deleted, keptBest } = deleteGalleryDuplicates(itemIds);
  return NextResponse.json({ ok: true, deleted, keptBest });
}
