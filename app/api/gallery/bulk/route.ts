import { NextResponse } from "next/server";
import { db, GalleryItemRow } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { deleteMediaFiles } from "@/lib/gallery-storage";

export const dynamic = "force-dynamic";

type Action = "favorite" | "unfavorite" | "trash" | "restore" | "delete";
const ACTIONS: Action[] = ["favorite", "unfavorite", "trash", "restore", "delete"];

// Apply an action to a set of the current user's items (multi-select support).
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = Number(session.sub);

  const body = await request.json().catch(() => ({}));
  const action: Action = body.action;
  const ids: number[] = Array.isArray(body.ids)
    ? body.ids.map((n: unknown) => Number(n)).filter((n: number) => Number.isInteger(n))
    : [];

  if (!ACTIONS.includes(action)) {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }
  if (ids.length === 0) {
    return NextResponse.json({ error: "No items selected." }, { status: 400 });
  }

  const placeholders = ids.map(() => "?").join(",");
  // Only ever touch rows owned by this user.
  const owned = db
    .prepare(
      `SELECT id, storage_key FROM gallery_items
       WHERE user_id = ? AND id IN (${placeholders})`
    )
    .all(userId, ...ids) as Pick<GalleryItemRow, "id" | "storage_key">[];

  const ownedIds = owned.map((r) => r.id);
  if (ownedIds.length === 0) {
    return NextResponse.json({ ok: true, affected: 0 });
  }
  const ownedPlaceholders = ownedIds.map(() => "?").join(",");

  const run = db.transaction(() => {
    if (action === "favorite" || action === "unfavorite") {
      db.prepare(
        `UPDATE gallery_items SET is_favorite = ? WHERE id IN (${ownedPlaceholders})`
      ).run(action === "favorite" ? 1 : 0, ...ownedIds);
    } else if (action === "trash") {
      db.prepare(
        `UPDATE gallery_items SET is_deleted = 1, deleted_at = datetime('now')
         WHERE id IN (${ownedPlaceholders})`
      ).run(...ownedIds);
    } else if (action === "restore") {
      db.prepare(
        `UPDATE gallery_items SET is_deleted = 0, deleted_at = NULL
         WHERE id IN (${ownedPlaceholders})`
      ).run(...ownedIds);
    } else if (action === "delete") {
      for (const row of owned) deleteMediaFiles(userId, row.storage_key);
      db.prepare(
        `DELETE FROM gallery_items WHERE id IN (${ownedPlaceholders})`
      ).run(...ownedIds);
    }
  });
  run();

  return NextResponse.json({ ok: true, affected: ownedIds.length });
}
