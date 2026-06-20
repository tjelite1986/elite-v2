import { NextResponse } from "next/server";
import { db, PostCreatorRow, PostMediaRow } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getPostRow } from "@/lib/posts";
import { usernameTaken } from "@/lib/profiles";
import { movePostImageToAuthor } from "@/lib/posts-storage";

export const dynamic = "force-dynamic";

// Reassign a post to a different mirrored creator (admin only). Used to fix
// imports that landed under the wrong/fallback creator. Body is either
// { creatorId } for an existing creator or { username } to find-or-create one.
// Moves the post's media files into the new creator's folder, then re-points
// author_creator_id + each media storage_key.
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const post = getPostRow(Number(params.id));
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));

  // Resolve the target creator: an existing id, or find-or-create by username.
  let creator: PostCreatorRow | undefined;
  if (body?.creatorId) {
    creator = db
      .prepare("SELECT * FROM post_creators WHERE id = ?")
      .get(Number(body.creatorId)) as PostCreatorRow | undefined;
    if (!creator) {
      return NextResponse.json({ error: "Creator not found." }, { status: 404 });
    }
  } else if (typeof body?.username === "string" && body.username.trim()) {
    const username = body.username.trim().toLowerCase().replace(/[^a-z0-9._]/g, "");
    if (username.length < 2) {
      return NextResponse.json({ error: "Invalid username." }, { status: 400 });
    }
    creator = db
      .prepare("SELECT * FROM post_creators WHERE username = ?")
      .get(username) as PostCreatorRow | undefined;
    if (!creator) {
      // A username already used by a real user can't double as a creator handle.
      if (usernameTaken(username)) {
        return NextResponse.json(
          { error: "That username is taken by a user." },
          { status: 400 }
        );
      }
      const res = db
        .prepare(
          "INSERT INTO post_creators (username, display_name, source) VALUES (?, ?, 'manual')"
        )
        .run(username, username);
      creator = db
        .prepare("SELECT * FROM post_creators WHERE id = ?")
        .get(Number(res.lastInsertRowid)) as PostCreatorRow;
    }
  } else {
    return NextResponse.json({ error: "A target creator is required." }, { status: 400 });
  }

  if (post.author_creator_id === creator.id) {
    return NextResponse.json({ ok: true, creatorId: creator.id });
  }

  const media = db
    .prepare("SELECT * FROM post_media WHERE post_id = ?")
    .all(post.id) as PostMediaRow[];

  try {
    db.transaction(() => {
      const upd = db.prepare("UPDATE post_media SET storage_key = ? WHERE id = ?");
      for (const m of media) {
        const newKey = movePostImageToAuthor(m.storage_key, creator!.username);
        upd.run(newKey, m.id);
      }
      // Switch authorship to the creator (clears any user authorship).
      db.prepare(
        "UPDATE posts SET author_creator_id = ?, author_user_id = NULL WHERE id = ?"
      ).run(creator!.id, post.id);
    })();
  } catch (err) {
    console.error("[posts] author reassign failed:", err);
    return NextResponse.json({ error: "Reassign failed." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    creatorId: creator.id,
    username: creator.username,
  });
}
