import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { getShort } from "@/lib/shorts";

export const dynamic = "force-dynamic";

// Toggle a clip's public/private visibility. The uploader can change their own
// clip; admins can change any. Body: { isPrivate: boolean }.
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
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
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const isPrivate = body?.isPrivate ? 1 : 0;

  db.prepare("UPDATE shorts SET is_private = ? WHERE id = ?").run(
    isPrivate,
    short.id
  );
  return NextResponse.json({ ok: true, is_private: Boolean(isPrivate) });
}
