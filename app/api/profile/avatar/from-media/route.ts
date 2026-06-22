import { NextResponse } from "next/server";
import fs from "node:fs";
import { PostMediaRow, PostRow } from "@/lib/db";
import { qb, getOne } from "@/lib/kysely";
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
  const media = getOne<PostMediaRow>(
    qb.selectFrom("post_media").selectAll().where("id", "=", Number(body?.mediaId))
  );
  if (!media) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const post = getOne<PostRow>(
    qb.selectFrom("posts").selectAll().where("id", "=", media.post_id).where("is_deleted", "=", 0)
  );
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ownsAsUser = post.author_user_id === userId;
  const isAdmin = session.role === "admin";
  if (!ownsAsUser && !(isAdmin && post.author_creator_id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // The avatar belongs to the post's author, keyed by their handle.
  let handle: string;
  if (post.author_user_id) {
    const u = getOne<{ username: string }>(
      qb.selectFrom("user_profiles").select("username").where("user_id", "=", post.author_user_id)
    );
    if (!u) return NextResponse.json({ error: "Not found" }, { status: 404 });
    handle = handleOf(u.username);
  } else {
    const c = getOne<{ username: string }>(
      qb.selectFrom("post_creators").select("username").where("id", "=", post.author_creator_id!)
    );
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
