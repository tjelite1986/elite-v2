import { NextResponse } from "next/server";
import fs from "node:fs";
import { db, PostMediaRow, PostRow } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { setHandleAvatar } from "@/lib/profiles";
import { handleOf } from "@/lib/directory";
import { mediaPathFor, storeAvatar } from "@/lib/posts-storage";

export const dynamic = "force-dynamic";

// Use an existing post image as the profile picture. Sets the avatar of whoever
// authored the post: the viewer (their own post) or, for admins, the post's
// mirrored creator.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = Number(session.sub);

  const body = await request.json().catch(() => ({}));
  const media = db
    .prepare("SELECT * FROM post_media WHERE id = ?")
    .get(Number(body?.mediaId)) as PostMediaRow | undefined;
  if (!media) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const post = db
    .prepare("SELECT * FROM posts WHERE id = ? AND is_deleted = 0")
    .get(media.post_id) as PostRow | undefined;
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ownsAsUser = post.author_user_id === userId;
  const isAdmin = session.role === "admin";
  if (!ownsAsUser && !(isAdmin && post.author_creator_id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // The avatar belongs to the post's author, keyed by their handle.
  let handle: string;
  if (post.author_user_id) {
    const u = db
      .prepare("SELECT username FROM user_profiles WHERE user_id = ?")
      .get(post.author_user_id) as { username: string } | undefined;
    if (!u) return NextResponse.json({ error: "Not found" }, { status: 404 });
    handle = handleOf(u.username);
  } else {
    const c = db
      .prepare("SELECT username FROM post_creators WHERE id = ?")
      .get(post.author_creator_id) as { username: string } | undefined;
    if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
    handle = handleOf(c.username);
  }

  const filePath = mediaPathFor(media.storage_key);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Image file missing." }, { status: 404 });
  }

  try {
    const buffer = fs.readFileSync(filePath);
    const key = await storeAvatar(media.storage_key, "image/jpeg", buffer);
    setHandleAvatar(handle, key);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not set avatar." },
      { status: 400 }
    );
  }
}
