import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasShortsPermission } from "@/lib/permissions";
import { has18Access } from "@/lib/shorts-gate";
import { deleteDuplicates, shortChannels } from "@/lib/shorts-duplicates";

export const dynamic = "force-dynamic";

// Delete the chosen duplicate clips: requires both shorts_settings and
// shorts18_settings, since selected group ids may span both channels. Pass
// { shortIds: number[] }; the kept "best" clip of a group is refused so a
// group can't be wiped whole. Soft-deletes the rows and removes the files
// from disk.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
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

  // The permission check above is role/permission-based, not the personal
  // 18+ PIN — re-check has18Access() here too when any selected clip is in
  // the 18+ channel, so this route can't delete 18+ clips for a caller who
  // hasn't unlocked their own PIN (same pattern as the video duplicates
  // route's visibilityFilter).
  const channels = shortChannels(shortIds);
  const touches18 = [...channels.values()].some((c) => c === "18plus");
  if (touches18 && !(await has18Access())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { deleted, skippedBest } = deleteDuplicates(shortIds);
  return NextResponse.json({ ok: true, deleted, skippedBest });
}
