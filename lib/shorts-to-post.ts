import fs from "node:fs";
import crypto from "node:crypto";
import { db } from "./db";
import { qb, getOne } from "./kysely";
import { getShort } from "./shorts";
import { videoPathFor, userHomeDir, deleteShortFiles } from "./shorts-storage";
import { authorSlug, storePostVideoFromFile } from "./posts-storage";
import { parseHashtags } from "./posts";

// Move a short into the posts module as a single-video post (the Videos tab).
// The clip's caption becomes the post caption (hashtags parsed) and an 18+ clip
// becomes an 18+ post. Once the post exists the short is retired the same way
// the delete route does (soft-delete first, then unlink). Likes/comments on the
// short are NOT carried over — same trade-off as deleting it.
export function moveShortToVideoPost(
  shortId: number
): { ok: true; postId: number } | { ok: false; error: string } {
  const short = getShort(shortId);
  if (!short) return { ok: false, error: "Not found" };
  if (short.status !== "ready") {
    return { ok: false, error: "The clip is still processing." };
  }
  const src = videoPathFor(short.channel, short.storage_key);
  if (!fs.existsSync(src)) {
    return { ok: false, error: "The video file is missing." };
  }

  // Resolve the post author: the uploader for user uploads (media stored under
  // their profile home), else a mirrored creator matching the shorts profile's
  // handle (find-or-create, mirroring the importer).
  let authorUserId: number | null = null;
  let authorCreatorId: number | null = null;
  let slug = "unknown";
  let userHome: string | null = null;
  if (short.uploader_id) {
    authorUserId = short.uploader_id;
    const prof = getOne<{ username: string | null }>(
      qb
        .selectFrom("user_profiles")
        .select("username")
        .where("user_id", "=", short.uploader_id)
    );
    userHome = userHomeDir(short.uploader_id, prof?.username ?? null);
    slug = authorSlug(prof?.username);
  } else if (short.profile_id) {
    const sp = getOne<{ name: string }>(
      qb
        .selectFrom("short_profiles")
        .select("name")
        .where("id", "=", short.profile_id)
    );
    const username =
      (sp?.name || "imported")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._]+/g, "")
        .replace(/^[._]+|[._]+$/g, "")
        .slice(0, 30) || "imported";
    const existing = getOne<{ id: number }>(
      qb.selectFrom("post_creators").select("id").where("username", "=", username)
    );
    authorCreatorId = existing
      ? existing.id
      : Number(
          db
            .prepare(
              "INSERT INTO post_creators (username, display_name, source) VALUES (?, ?, 'import')"
            )
            .run(username, username).lastInsertRowid
        );
    slug = authorSlug(username);
  } else {
    return { ok: false, error: "The clip has no author." };
  }

  const stored = storePostVideoFromFile(slug, src, userHome);
  // Dedup key against future re-imports of the same file (source bytes, like
  // the importer — the remux output isn't byte-stable).
  const contentHash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(src))
    .digest("hex");

  const caption = short.caption;
  const postId = db.transaction(() => {
    const res = db
      .prepare(
        "INSERT INTO posts (author_user_id, author_creator_id, caption, is_adult) VALUES (?, ?, ?, ?)"
      )
      .run(authorUserId, authorCreatorId, caption, short.channel === "18plus" ? 1 : 0);
    const id = Number(res.lastInsertRowid);
    db.prepare(
      `INSERT INTO post_media (post_id, storage_key, mime_type, width, height, position, content_hash)
       VALUES (?, ?, ?, ?, ?, 0, ?)`
    ).run(
      id,
      stored.storageKey,
      stored.mimeType,
      stored.width ?? short.width,
      stored.height ?? short.height,
      contentHash
    );
    for (const tag of parseHashtags(caption)) {
      db.prepare("INSERT OR IGNORE INTO post_hashtags (post_id, tag) VALUES (?, ?)").run(
        id,
        tag
      );
    }
    return id;
  })();

  db.prepare("UPDATE shorts SET is_deleted = 1 WHERE id = ?").run(short.id);
  db.prepare("DELETE FROM short_dupe_groups WHERE short_id = ?").run(short.id);
  deleteShortFiles(short.channel, short.storage_key, short.poster_key);

  return { ok: true, postId };
}
