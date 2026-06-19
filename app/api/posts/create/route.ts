import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { ensureUserProfile } from "@/lib/profiles";
import { parseHashtags } from "@/lib/posts";
import { storePostImage, authorSlug } from "@/lib/posts-storage";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_FILES = 10;

// Create a post authored by the current user from one or more uploaded images.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = Number(session.sub);
  const profile = ensureUserProfile(userId, session.email);

  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const caption = (form.get("caption")?.toString() ?? "").trim().slice(0, 2200) || null;
  const isAdult = form.get("is_adult") === "1" ? 1 : 0;
  const files = form.getAll("files").filter((f): f is File => f instanceof File);

  if (files.length === 0) {
    return NextResponse.json({ error: "At least one image is required." }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json(
      { error: `At most ${MAX_FILES} images per post.` },
      { status: 400 }
    );
  }

  const slug = authorSlug(profile.username);
  const stored: { storageKey: string; mimeType: string; width: number | null; height: number | null }[] = [];
  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    try {
      stored.push(await storePostImage(slug, file.name, file.type, buffer));
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Could not process an image." },
        { status: 400 }
      );
    }
  }

  // Insert the post + its media + hashtags atomically.
  const postId = db.transaction(() => {
    const res = db
      .prepare(
        "INSERT INTO posts (author_user_id, caption, is_adult) VALUES (?, ?, ?)"
      )
      .run(userId, caption, isAdult);
    const id = Number(res.lastInsertRowid);

    const insertMedia = db.prepare(
      `INSERT INTO post_media (post_id, storage_key, mime_type, width, height, position)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    stored.forEach((m, i) =>
      insertMedia.run(id, m.storageKey, m.mimeType, m.width, m.height, i)
    );

    const insertTag = db.prepare(
      "INSERT OR IGNORE INTO post_hashtags (post_id, tag) VALUES (?, ?)"
    );
    for (const tag of parseHashtags(caption)) insertTag.run(id, tag);

    return id;
  })();

  return NextResponse.json({ ok: true, id: postId });
}
