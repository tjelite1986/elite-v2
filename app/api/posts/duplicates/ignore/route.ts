import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { ignorePostDupeGroup } from "@/lib/posts-duplicates";

export const dynamic = "force-dynamic";

// Mark a group as "not duplicates" (admin only). Pass { mediaIds: number[] } —
// every pairing among them is remembered so future perceptual scans never
// re-group them, and the group is dropped from the current results.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session, "posts_settings")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const mediaIds = Array.isArray(body.mediaIds)
    ? body.mediaIds.map((n: unknown) => Number(n))
    : [];
  if (mediaIds.length < 2) {
    return NextResponse.json(
      { error: "Need at least two images to dismiss." },
      { status: 400 }
    );
  }

  const { ignored } = ignorePostDupeGroup(mediaIds);
  return NextResponse.json({ ok: true, ignored });
}
