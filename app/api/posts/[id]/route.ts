import { NextResponse } from "next/server";
import { db, PostMediaRow } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { has18Access } from "@/lib/shorts-gate";
import { getPost, getPostRow, parseHashtags } from "@/lib/posts";
import { deletePostImageFiles } from "@/lib/posts-storage";

export const dynamic = "force-dynamic";

// Single post (gated for adult content).
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const post = getPost(Number(params.id), Number(session.sub));
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (post.is_adult && !(await has18Access())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ post });
}

// Edit a post's caption (author or admin). Re-derives hashtags.
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = Number(session.sub);

  const post = getPostRow(Number(params.id));
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (post.author_user_id !== userId && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  if (typeof body?.caption !== "string") {
    return NextResponse.json({ error: "Invalid caption." }, { status: 400 });
  }
  const caption = body.caption.trim().slice(0, 2200) || null;

  db.transaction(() => {
    db.prepare("UPDATE posts SET caption = ? WHERE id = ?").run(caption, post.id);
    db.prepare("DELETE FROM post_hashtags WHERE post_id = ?").run(post.id);
    const insertTag = db.prepare(
      "INSERT OR IGNORE INTO post_hashtags (post_id, tag) VALUES (?, ?)"
    );
    for (const tag of parseHashtags(caption)) insertTag.run(post.id, tag);
  })();

  return NextResponse.json({ ok: true, caption });
}

// Delete a post (author or admin): soft-delete the row and unlink its images.
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = Number(session.sub);

  const post = getPostRow(Number(params.id));
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (post.author_user_id !== userId && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const media = db
    .prepare("SELECT * FROM post_media WHERE post_id = ?")
    .all(post.id) as PostMediaRow[];
  for (const m of media) deletePostImageFiles(m.storage_key);

  db.prepare("UPDATE posts SET is_deleted = 1 WHERE id = ?").run(post.id);
  return NextResponse.json({ ok: true });
}
