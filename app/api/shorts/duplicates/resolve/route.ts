import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasShortsPermission } from "@/lib/permissions";
import { deleteDuplicates } from "@/lib/shorts-duplicates";

export const dynamic = "force-dynamic";

// Delete the chosen duplicate clips (admin only). Pass { shortIds: number[] };
// the kept "best" clip of a group is refused so a group can't be wiped whole.
// Soft-deletes the rows and removes the files from disk.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Selected group ids may span both channels, so require both permissions.
  if (!hasShortsPermission(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const shortIds = Array.isArray(body.shortIds)
    ? body.shortIds.map((n: unknown) => Number(n))
    : [];
  if (shortIds.length === 0) {
    return NextResponse.json({ error: "No clips selected." }, { status: 400 });
  }

  const { deleted, skippedBest } = deleteDuplicates(shortIds);
  return NextResponse.json({ ok: true, deleted, skippedBest });
}
