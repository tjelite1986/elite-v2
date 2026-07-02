import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { deletePostDuplicates } from "@/lib/posts-duplicates";

export const dynamic = "force-dynamic";

// Delete the chosen duplicate images (admin only). Pass { mediaIds: number[] };
// any image may be chosen, but if a whole group is selected its best is auto-kept
// so a group is never wiped whole. Removes the files from disk and retires any
// post left without images.
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
  if (mediaIds.length === 0) {
    return NextResponse.json({ error: "No images selected." }, { status: 400 });
  }

  const { deleted, keptBest } = deletePostDuplicates(mediaIds);
  return NextResponse.json({ ok: true, deleted, keptBest });
}
