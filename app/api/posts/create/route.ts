import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { ensureUserProfile } from "@/lib/profiles";
import { has18Access } from "@/lib/shorts-gate";
import { parseHashtags } from "@/lib/posts";
import {
  storePostImage,
  storePostVideo,
  isSupportedPostVideo,
  authorSlug,
  renamePostImageFiles,
} from "@/lib/posts-storage";
import { userHomeDir } from "@/lib/shorts-storage";
import { uploadStem } from "@/lib/import-naming";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_FILES = 10;
// Videos are buffered in memory before storing — cap them so one huge upload
// can't exhaust the Pi's RAM.
const MAX_VIDEO_BYTES = 300 * 1024 * 1024;

// Create a post authored by the current user from uploaded images and/or videos.
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
  if (isAdult && !(await has18Access())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const files = form.getAll("files").filter((f): f is File => f instanceof File);

  if (files.length === 0) {
    return NextResponse.json(
      { error: "At least one image or video is required." },
      { status: 400 }
    );
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json(
      { error: `At most ${MAX_FILES} files per post.` },
      { status: 400 }
    );
  }

  const slug = authorSlug(profile.username);
  const userHome = userHomeDir(userId, profile.username);
  const stored: { storageKey: string; mimeType: string; width: number | null; height: number | null }[] = [];
  for (const file of files) {
    try {
      if (isSupportedPostVideo(file.name, file.type)) {
        if (file.size > MAX_VIDEO_BYTES) {
          throw new Error("Video is too large (max 300 MB).");
        }
        const buffer = Buffer.from(await file.arrayBuffer());
        stored.push(await storePostVideo(slug, file.name, buffer, userHome));
      } else {
        const buffer = Buffer.from(await file.arrayBuffer());
        stored.push(await storePostImage(slug, file.name, file.type, buffer, userHome));
      }
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Could not process a file." },
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

  // Rename each media file to a site-relevant self-describing name now that we
  // know the post id, and persist the new keys.
  stored.forEach((m, i) => {
    try {
      const newKey = renamePostImageFiles(
        m.storageKey,
        uploadStem(files[i].name, caption, postId, "post")
      );
      db.prepare(
        "UPDATE post_media SET storage_key = ? WHERE post_id = ? AND position = ?"
      ).run(newKey, postId, i);
    } catch {
      /* keep the original stored name if the rename fails */
    }
  });

  return NextResponse.json({ ok: true, id: postId });
}
