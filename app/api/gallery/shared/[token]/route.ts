import { NextResponse } from "next/server";
import { resolveShare, sharedItems } from "@/lib/album-share";

export const dynamic = "force-dynamic";

// Public (no-auth) album contents for a valid share token.
export async function GET(
  _request: Request,
  { params }: { params: { token: string } }
) {
  const share = resolveShare(params.token);
  if (!share) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 });
  }
  return NextResponse.json({
    name: share.name,
    items: sharedItems(share.album_id),
  });
}
