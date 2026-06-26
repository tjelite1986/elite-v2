import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { deleteSmartAlbum } from "@/lib/smart-albums";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  deleteSmartAlbum(Number(session.sub), Number(params.id));
  return NextResponse.json({ ok: true });
}
