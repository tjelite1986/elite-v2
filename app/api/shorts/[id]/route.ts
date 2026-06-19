import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { getShort } from "@/lib/shorts";
import { deleteShortFiles } from "@/lib/shorts-storage";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await getSession();
  if (!session) return { error: "Unauthorized", status: 401 as const };
  if (session.role !== "admin") return { error: "Forbidden", status: 403 as const };
  return { session };
}

// Rename a clip's title/caption (admin only).
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const short = getShort(Number(params.id));
  if (!short) {
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

// Delete a clip (admin only): soft-delete the row, remove the files from disk,
// and drop it from any duplicate-scan group.
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const short = getShort(Number(params.id));
  if (!short) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  deleteShortFiles(short.channel, short.storage_key, short.poster_key);
  db.prepare("UPDATE shorts SET is_deleted = 1 WHERE id = ?").run(short.id);
  db.prepare("DELETE FROM short_dupe_groups WHERE short_id = ?").run(short.id);
  return NextResponse.json({ ok: true });
}
