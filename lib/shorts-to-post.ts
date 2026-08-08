import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { db, PostMediaRow, PostRow, ShortChannel } from "./db";
import { qb, getOne } from "./kysely";
import { getShort } from "./shorts";
import {
  PROFILE_ROOT,
  channelDir,
  profileSlug,
  videoPathFor,
  userHomeDir,
  ensureUserHome,
  deleteShortFiles,
} from "./shorts-storage";
import {
  authorSlug,
  storePostVideoFromFile,
  mediaPathFor,
  deletePostImageFiles,
} from "./posts-storage";
import { findOrCreateShortProfile } from "./user-import";
import { parseHashtags } from "./posts";

// Move a short into the posts module as a single-video post (the Videos tab).
// The clip's caption becomes the post caption (hashtags parsed) and an 18+ clip
// becomes an 18+ post. Once the post exists the short is retired the same way
// the delete route does (soft-delete first, then unlink). Likes/comments on the
// short are NOT carried over — same trade-off as deleting it.
// Stream the file through SHA-256 instead of buffering it whole — clips can be
// hundreds of MB and this is a dedup key, not something that needs the buffer.
async function fileHash(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest("hex");
}

export async function moveShortToVideoPost(
  shortId: number
): Promise<{ ok: true; postId: number } | { ok: false; error: string }> {
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
  const contentHash = await fileHash(src);

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

// Non-square poster frame for a new short, mirroring the transcoder's
// makePoster (720 wide). Best effort — the transcoder's poster backfill covers
// a ready clip that ends up without one.
function makeShortPoster(videoPath: string, posterPath: string): boolean {
  for (const seek of ["1", "0"]) {
    try {
      execFileSync(
        "ffmpeg",
        ["-y", "-hide_banner", "-loglevel", "error", "-nostdin",
         "-ss", seek, "-i", videoPath, "-vframes", "1",
         "-vf", "scale='min(720,iw)':-2", "-q:v", "5", posterPath],
        { stdio: "ignore" }
      );
    } catch {
      /* try the next seek */
    }
    if (fs.existsSync(posterPath) && fs.statSync(posterPath).size > 0) return true;
  }
  return false;
}

// The reverse move: turn one video media item of a post into a short. The post
// caption carries over, an 18+ post lands on the 18+ channel, a user post
// becomes that user's upload, and a creator post finds-or-creates the same
// handle's shorts profile. MP4 sources are remuxed (stream copy) straight to a
// ready .web.mp4; a source the remux can't handle (e.g. WebM/VP9) is copied
// as-is and inserted 'pending' for the transcode job. The media item is then
// removed from the post; a post that loses its last media is soft-deleted.
export function moveVideoPostMediaToShort(
  mediaId: number
): { ok: true; shortId: number; postDeleted: boolean } | { ok: false; error: string } {
  const media = getOne<PostMediaRow>(
    qb.selectFrom("post_media").selectAll().where("id", "=", mediaId)
  );
  if (!media) return { ok: false, error: "Not found" };
  if (!media.mime_type.startsWith("video/")) {
    return { ok: false, error: "Only videos can move to shorts." };
  }
  const post = getOne<PostRow>(
    qb
      .selectFrom("posts")
      .selectAll()
      .where("id", "=", media.post_id)
      .where("is_deleted", "=", 0)
  );
  if (!post) return { ok: false, error: "Not found" };

  const src = mediaPathFor(media.storage_key);
  if (!fs.existsSync(src)) {
    return { ok: false, error: "The video file is missing." };
  }

  const channel: ShortChannel = post.is_adult ? "18plus" : "main";

  // Resolve the destination: an uploader home for user posts, a (find-or-create)
  // shorts profile folder for creator posts.
  let uploaderId: number | null = null;
  let profileId: number | null = null;
  let destDir: string;
  let keyPrefix: string;
  if (post.author_user_id) {
    uploaderId = post.author_user_id;
    const prof = getOne<{ username: string | null }>(
      qb
        .selectFrom("user_profiles")
        .select("username")
        .where("user_id", "=", post.author_user_id)
    );
    const home = ensureUserHome(post.author_user_id, prof?.username ?? null);
    const section = channel === "18plus" ? "shorts18" : "shorts";
    keyPrefix = `${home}/${section}`;
    destDir = path.join(PROFILE_ROOT, keyPrefix);
  } else if (post.author_creator_id) {
    const creator = getOne<{ username: string }>(
      qb
        .selectFrom("post_creators")
        .select("username")
        .where("id", "=", post.author_creator_id)
    );
    if (!creator) return { ok: false, error: "Author not found." };
    profileId = findOrCreateShortProfile(creator.username, channel);
    keyPrefix = profileSlug(creator.username);
    destDir = path.join(channelDir(channel), keyPrefix);
  } else {
    return { ok: false, error: "The post has no author." };
  }
  fs.mkdirSync(destDir, { recursive: true });

  const uuid = randomUUID();
  let storageKey: string;
  let status: "ready" | "pending";
  try {
    const webPath = path.join(destDir, `${uuid}.web.mp4`);
    execFileSync(
      "ffmpeg",
      ["-y", "-hide_banner", "-loglevel", "error", "-nostdin",
       "-i", src, "-c", "copy", "-movflags", "+faststart", webPath],
      { stdio: "ignore" }
    );
    storageKey = `${keyPrefix}/${uuid}.web.mp4`;
    status = "ready";
  } catch {
    // Remux failed (e.g. WebM source) — hand the copy to the transcode job.
    fs.rmSync(path.join(destDir, `${uuid}.web.mp4`), { force: true });
    const ext = path.extname(media.storage_key).slice(1) || "mp4";
    fs.copyFileSync(src, path.join(destDir, `${uuid}.${ext}`));
    storageKey = `${keyPrefix}/${uuid}.${ext}`;
    status = "pending";
  }

  let posterKey: string | null = null;
  if (status === "ready") {
    const pk = `${keyPrefix}/${uuid}.jpg`;
    if (makeShortPoster(videoPathFor(channel, storageKey), path.join(destDir, `${uuid}.jpg`))) {
      posterKey = pk;
    }
  }

  const res = db
    .prepare(
      `INSERT INTO shorts
         (channel, profile_id, uploader_id, caption, storage_key, poster_key,
          mime_type, width, height, source, status)
       VALUES (?, ?, ?, ?, ?, ?, 'video/mp4', ?, ?, 'import', ?)`
    )
    .run(
      channel,
      profileId,
      uploaderId,
      post.caption,
      storageKey,
      posterKey,
      media.width,
      media.height,
      status
    );
  const shortId = Number(res.lastInsertRowid);

  // The short exists — remove the media from the post (dupe-group rows cascade)
  // and retire the post if that was its last item, then unlink the files.
  const postDeleted = db.transaction(() => {
    db.prepare("DELETE FROM post_media WHERE id = ?").run(media.id);
    const left = db
      .prepare("SELECT COUNT(*) AS n FROM post_media WHERE post_id = ?")
      .get(post.id) as { n: number };
    if (left.n === 0) {
      db.prepare("UPDATE posts SET is_deleted = 1 WHERE id = ?").run(post.id);
      return true;
    }
    return false;
  })();
  deletePostImageFiles(media.storage_key);

  return { ok: true, shortId, postDeleted };
}
