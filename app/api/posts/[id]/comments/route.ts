import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { qb, getOne, getAll } from "@/lib/kysely";
import { getSession } from "@/lib/auth";
import { has18Access } from "@/lib/shorts-gate";
import { getPostRow } from "@/lib/posts";
import { notify } from "@/lib/notifications";

export const dynamic = "force-dynamic";

// List a post's comments with author handle/avatar.
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Re-check the 18+ gate here too — every sibling interaction endpoint must
  // gate independently, not just the post/media GET.
  const post = getPostRow(Number(params.id));
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (post.is_adult && !(await has18Access())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const comments = getAll(
    qb
      .selectFrom("post_comments as c")
      .leftJoin("user_profiles as up", "up.user_id", "c.user_id")
      .select([
        "c.id",
        "c.body",
        "c.created_at",
        "up.username as author_username",
        "up.avatar_key as author_avatar_key",
      ])
      .where("c.post_id", "=", Number(params.id))
      .orderBy("c.id")
  );
  return NextResponse.json({ comments });
}

// Add a comment. Notifies the post's user-author.
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = Number(session.sub);

  const post = getPostRow(Number(params.id));
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (post.is_adult && !(await has18Access())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!text) return NextResponse.json({ error: "A comment is required." }, { status: 400 });

  const res = db
    .prepare("INSERT INTO post_comments (post_id, user_id, body) VALUES (?, ?, ?)")
    .run(post.id, userId, text.slice(0, 2000));
  const commentId = Number(res.lastInsertRowid);

  if (post.author_user_id) {
    notify({
      recipientId: post.author_user_id,
      actorId: userId,
      type: "comment",
      postId: post.id,
      commentId,
    });
  }

  const comment = getOne(
    qb
      .selectFrom("post_comments as c")
      .leftJoin("user_profiles as up", "up.user_id", "c.user_id")
      .select([
        "c.id",
        "c.body",
        "c.created_at",
        "up.username as author_username",
        "up.avatar_key as author_avatar_key",
      ])
      .where("c.id", "=", commentId)
  );
  return NextResponse.json({ ok: true, comment });
}
