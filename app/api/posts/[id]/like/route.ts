import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { qb, getOne } from "@/lib/kysely";
import { getSession } from "@/lib/auth";
import { has18Access } from "@/lib/shorts-gate";
import { getPostRow } from "@/lib/posts";
import { notify } from "@/lib/notifications";

export const dynamic = "force-dynamic";

// Toggle the viewer's like on a post. Notifies the post's user-author on a new
// like (creator-authored posts have no recipient).
export async function POST(
  _request: Request,
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

  const existing = getOne(
    qb
      .selectFrom("post_likes")
      .select("post_id")
      .where("post_id", "=", post.id)
      .where("user_id", "=", userId)
  );

  let liked: boolean;
  if (existing) {
    db.prepare("DELETE FROM post_likes WHERE post_id = ? AND user_id = ?").run(post.id, userId);
    liked = false;
  } else {
    db.prepare("INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)").run(post.id, userId);
    liked = true;
    if (post.author_user_id) {
      notify({ recipientId: post.author_user_id, actorId: userId, type: "like", postId: post.id });
    }
  }

  const like_count =
    getOne<{ c: number }>(
      qb
        .selectFrom("post_likes")
        .select((eb) => eb.fn.countAll<number>().as("c"))
        .where("post_id", "=", post.id)
    )?.c ?? 0;
  return NextResponse.json({ ok: true, liked, like_count });
}
