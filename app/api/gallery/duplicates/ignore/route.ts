import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ignoreGalleryDupeGroup } from "@/lib/gallery-duplicates";

export const dynamic = "force-dynamic";

// Mark a group as "not duplicates" (admin only). Pass { itemIds: number[] } —
// every pairing among them is remembered so future perceptual scans never
// re-group them, and the group is dropped from the current results.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const itemIds = Array.isArray(body.itemIds)
    ? body.itemIds.map((n: unknown) => Number(n))
    : [];
  if (itemIds.length < 2) {
    return NextResponse.json(
      { error: "Need at least two images to dismiss." },
      { status: 400 }
    );
  }

  const { ignored } = ignoreGalleryDupeGroup(itemIds);
  return NextResponse.json({ ok: true, ignored });
}
