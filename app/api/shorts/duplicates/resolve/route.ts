import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { hasShortsPermission } from "@/lib/permissions";
import { has18Access } from "@/lib/shorts-gate";
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

  // Deleting an 18+ clip is still an 18+-channel action — this route must not
  // trust the settings permission alone to have gated that, the same rule
  // every other 18+ write path in the app already follows.
  const placeholders = shortIds.map(() => "?").join(",");
  const hasAdultClip =
    db
      .prepare(`SELECT 1 FROM shorts WHERE id IN (${placeholders}) AND channel = '18plus' LIMIT 1`)
      .get(...shortIds) !== undefined;
  if (hasAdultClip && !(await has18Access())) {
    return NextResponse.json({ error: "Access denied." }, { status: 403 });
  }

  const { deleted, skippedBest } = deleteDuplicates(shortIds);
  return NextResponse.json({ ok: true, deleted, skippedBest });
}
