import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { getShort } from "@/lib/shorts";
import { deleteShortFiles } from "@/lib/shorts-storage";

export const dynamic = "force-dynamic";

// Rename a clip's title/caption (the uploader of their own clip, or an admin —
// same guard as delete, so the in-player "Edit title" works for own uploads).
export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const short = getShort(Number(params.id));
  if (!short) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const isOwner = short.uploader_id === Number(session.sub);
  if (session.role !== "admin" && !isOwner) {
    // 404, not 403 — mirrors the video/poster routes so a private clip's
    // existence isn't revealed to a non-owner.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  if (typeof body?.caption !== "string") {
    return NextResponse.json({ error: "Invalid caption." }, { status: 400 });
  }
  const caption = body.caption.trim().slice(0, 2000) || null;

  db.prepare("UPDATE shorts SET caption = ? WHERE id = ?").run(caption, short.id);
  return NextResponse.json({ ok: true, caption });
}

// Delete a clip (the uploader of their own clip, or an admin): soft-delete the
// row, remove the files from disk, and drop it from any duplicate-scan group.
export async function DELETE(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const short = getShort(Number(params.id));
  if (!short) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const isOwner = short.uploader_id === Number(session.sub);
  if (session.role !== "admin" && !isOwner) {
    // 404, not 403 — mirrors the video/poster routes so a private clip's
    // existence isn't revealed to a non-owner.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Soft-delete FIRST, then unlink: if the file removal fails the clip is
  // already hidden and a retry can still find the files — the reverse order
  // could lose the files while the clip stays visible.
  db.prepare("UPDATE shorts SET is_deleted = 1 WHERE id = ?").run(short.id);
  db.prepare("DELETE FROM short_dupe_groups WHERE short_id = ?").run(short.id);
  deleteShortFiles(short.channel, short.storage_key, short.poster_key);
  return NextResponse.json({ ok: true });
}
