import { NextResponse } from "next/server";
import { db, PostMediaRow, PostRow } from "@/lib/db";
import { qb, getAll, getOne } from "@/lib/kysely";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Combine several of the caller's own posts into one carousel ("stack"). The
// first id is the target (keeps its caption); every other post's media is moved
// onto it in the given order, then the emptied source posts are soft-deleted.
// Media files are NOT unlinked — they now belong to the target post. Scoped to
// the author: every post must be owned by the caller (admins may merge any).
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = Number(session.sub);
  const isAdmin = session.role === "admin";

  const body = await request.json().catch(() => ({}));
  const ids: number[] = Array.isArray(body?.ids)
    ? Array.from(
        new Set(
          body.ids.map((n: unknown) => Number(n)).filter((n: number) => Number.isInteger(n) && n > 0)
        )
      )
    : [];

  if (ids.length < 2) {
    return NextResponse.json(
      { error: "Select at least two posts to combine." },
      { status: 400 }
    );
  }

  // Load every post and verify it exists, isn't deleted, and is the caller's.
  const posts = new Map<number, PostRow>();
  for (const id of ids) {
    const row = getOne<PostRow>(
      qb.selectFrom("posts").selectAll().where("id", "=", id).where("is_deleted", "=", 0)
    );
    if (!row) {
      return NextResponse.json({ error: `Post ${id} not found.` }, { status: 404 });
    }
    if (row.author_user_id !== userId && !isAdmin) {
      return NextResponse.json(
        { error: "You can only combine your own posts." },
        { status: 403 }
      );
    }
    posts.set(id, row);
  }

  const targetId = ids[0];
  const sourceIds = ids.slice(1);
  const anyAdult = ids.some((id) => posts.get(id)!.is_adult);

  const moveMedia = db.prepare(
    "UPDATE post_media SET post_id = ?, position = ? WHERE post_id = ? AND storage_key = ?"
  );

  const result = db.transaction(() => {
    // Continue numbering after the target's existing media.
    const start =
      (
        getOne<{ n: number }>(
          qb
            .selectFrom("post_media")
            .select((eb) => eb.fn.count<number>("storage_key").as("n"))
            .where("post_id", "=", targetId)
        )?.n ?? 0
      );
    let pos = Number(start);

    for (const srcId of sourceIds) {
      const media = getAll<PostMediaRow>(
        qb
          .selectFrom("post_media")
          .selectAll()
          .where("post_id", "=", srcId)
          .orderBy("position")
      );
      for (const m of media) {
        moveMedia.run(targetId, pos, srcId, m.storage_key);
        pos++;
      }
      // The source post is now empty; soft-delete it (files moved, not unlinked).
      db.prepare("UPDATE posts SET is_deleted = 1 WHERE id = ?").run(srcId);
      // Its likes/comments referenced a post that no longer shows; drop them so
      // counts don't leak onto nothing.
      db.prepare("DELETE FROM post_likes WHERE post_id = ?").run(srcId);
      db.prepare("DELETE FROM post_comments WHERE post_id = ?").run(srcId);
      db.prepare("DELETE FROM post_hashtags WHERE post_id = ?").run(srcId);
    }

    if (anyAdult) {
      db.prepare("UPDATE posts SET is_adult = 1 WHERE id = ?").run(targetId);
    }
    return pos;
  })();

  return NextResponse.json({ ok: true, postId: targetId, mediaCount: result });
}
