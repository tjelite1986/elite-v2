import { NextResponse } from "next/server";
import { PostMediaRow, PostRow } from "@/lib/db";
import { qb, getOne } from "@/lib/kysely";
import { getSession } from "@/lib/auth";
import { has18Access } from "@/lib/shorts-gate";
import { moveVideoPostMediaToShort } from "@/lib/shorts-to-post";

export const dynamic = "force-dynamic";

// Move a post's video media item into shorts (the author of their own post, or
// an admin) — the reverse of /api/shorts/[id]/to-post, same guard shape.
export async function POST(
  _request: Request,
  props: { params: Promise<{ mediaId: string }> }
) {
  const params = await props.params;
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const media = getOne<PostMediaRow>(
    qb.selectFrom("post_media").selectAll().where("id", "=", Number(params.mediaId))
  );
  if (!media) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const post = getOne<PostRow>(
    qb
      .selectFrom("posts")
      .selectAll()
      .where("id", "=", media.post_id)
      .where("is_deleted", "=", 0)
  );
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isOwner = post.author_user_id === Number(session.sub);
  if (session.role !== "admin" && !isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (post.is_adult && !(await has18Access())) {
    return NextResponse.json({ error: "Locked" }, { status: 403 });
  }

  try {
    const result = moveVideoPostMediaToShort(media, post);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      shortId: result.shortId,
      postDeleted: result.postDeleted,
    });
  } catch (err) {
    console.error("[posts] move to short failed:", err);
    return NextResponse.json({ error: "Move failed." }, { status: 500 });
  }
}
