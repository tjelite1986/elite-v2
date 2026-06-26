import { NextResponse } from "next/server";
import { db, GalleryItemRow } from "@/lib/db";
import { qb, getAll } from "@/lib/kysely";
import { getSession } from "@/lib/auth";
import { deleteMediaFiles } from "@/lib/gallery-storage";
import { addTagToItems } from "@/lib/gallery-tags";

export const dynamic = "force-dynamic";

type Action =
  | "favorite"
  | "unfavorite"
  | "trash"
  | "restore"
  | "delete"
  | "tag";
const ACTIONS: Action[] = [
  "favorite",
  "unfavorite",
  "trash",
  "restore",
  "delete",
  "tag",
];

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

  // Tagging is its own path (ownership-checked inside addTagToItems).
  if (action === "tag") {
    const affected = addTagToItems(
      userId,
      ids,
      typeof body.tag === "string" ? body.tag : ""
    );
    return NextResponse.json({ ok: true, affected });
  }

  // Only ever touch rows owned by this user.
  const owned = getAll<Pick<GalleryItemRow, "id" | "storage_key">>(
    qb
      .selectFrom("gallery_items")
      .select(["id", "storage_key"])
      .where("user_id", "=", userId)
      .where("id", "in", ids)
  );

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
