import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getSmartAlbum, resolveSmartItems } from "@/lib/smart-albums";

export const dynamic = "force-dynamic";

// Items matching a smart album's saved filter.
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = Number(session.sub);
  const album = getSmartAlbum(userId, Number(params.id));
  if (!album) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ items: resolveSmartItems(userId, album.criteria) });
}
