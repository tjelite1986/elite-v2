import fs from "node:fs";
import { db } from "./db";
import { mediaPathFor, deletePostImageFiles, POSTS_ROOT } from "./posts-storage";
import { PROFILE_ROOT, storageRootAvailable } from "./storage-roots";

// Post media resolves under POSTS_ROOT (creators/imports) or PROFILE_ROOT
// (user uploads); if either bind mount is missing, "file not found" means
// nothing and orphan handling must stand down.
function mediaRootsAvailable(): boolean {
  return storageRootAvailable(POSTS_ROOT) && storageRootAvailable(PROFILE_ROOT);
}

// Library maintenance for posts, mirroring lib/shorts-maintenance.ts. Two kinds
// of dead entries accumulate as files move/disappear on the host:
//   1. "orphan media" — a post_media row whose image file is gone from disk. The
//      image still shows in the grid/carousel but every load 404s. There's
//      nothing to keep, so dropping the row is always safe.
//   2. "empty posts" — a post left with no viewable image (every image was
//      removed/orphan-cleaned). It lingers as a blank card.

export interface OrphanMedia {
  id: number; // post_media.id
  post_id: number;
  caption: string | null;
  author_name: string | null;
  storage_key: string;
  created_at: string;
}

// Media rows of non-deleted posts whose resolved image path is missing on disk.
// One fs.stat per image, so it's fast enough to run inline in the request (no
// detached job like the dupe scanner).
export function findOrphanMedia(): OrphanMedia[] {
  // Unmounted-volume guard: with a media root missing every row would look
  // like an orphan and the hourly cleanup job would wipe the library.
  if (!mediaRootsAvailable()) {
    console.error(
      "[posts-maintenance] storage root missing or empty, skipping orphan scan"
    );
    return [];
  }
  const rows = db
    .prepare(
      `SELECT m.id, m.post_id, m.storage_key, p.caption, p.created_at,
              COALESCE(pc.username, u.email) AS author_name
         FROM post_media m
         JOIN posts p ON p.id = m.post_id AND p.is_deleted = 0
         LEFT JOIN users u ON u.id = p.author_user_id
         LEFT JOIN post_creators pc ON pc.id = p.author_creator_id
        ORDER BY m.id`
    )
    .all() as OrphanMedia[];

  return rows.filter((r) => !fs.existsSync(mediaPathFor(r.storage_key)));
}

// Delete the given media rows and unlink their display + thumbnail files (the
// display is already gone; the thumbnail may linger). The ON DELETE CASCADE on
// post_dupe_groups clears any dupe-scan rows. Re-checks each row is still a live,
// file-less orphan inside the transaction so an image that reappeared isn't
// removed. Returns how many went.
export function cleanupOrphanMedia(ids: number[]): { deleted: number } {
  const clean = Array.from(
    new Set(ids.filter((n) => Number.isInteger(n) && n > 0))
  );
  if (clean.length === 0) return { deleted: 0 };

  // Same unmounted-volume guard as the scan, plus a blast-radius cap: deleting
  // more than 20% of a non-trivial library in one sweep is far more likely a
  // mount problem than genuine rot — refuse and leave the rows for a human.
  if (!mediaRootsAvailable()) {
    console.error(
      "[posts-maintenance] storage root missing or empty, refusing cleanup"
    );
    return { deleted: 0 };
  }
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS n
           FROM post_media m
           JOIN posts p ON p.id = m.post_id AND p.is_deleted = 0`
      )
      .get() as { n: number }
  ).n;
  if (clean.length > 20 && clean.length > total * 0.2) {
    console.error(
      `[posts-maintenance] refusing to delete ${clean.length} of ${total} media rows (>20%) — storage mount problem?`
    );
    return { deleted: 0 };
  }

  const getMedia = db.prepare(
    `SELECT m.id, m.storage_key
       FROM post_media m
       JOIN posts p ON p.id = m.post_id AND p.is_deleted = 0
      WHERE m.id = ?`
  );
  const delMedia = db.prepare("DELETE FROM post_media WHERE id = ?");

  let deleted = 0;
  const tx = db.transaction(() => {
    for (const id of clean) {
      const media = getMedia.get(id) as
        | { id: number; storage_key: string }
        | undefined;
      if (!media) continue;
      // Guard against a TOCTOU race: only remove a row whose file is still gone.
      if (fs.existsSync(mediaPathFor(media.storage_key))) continue;
      deletePostImageFiles(media.storage_key);
      delMedia.run(id);
      deleted++;
    }
  });
  tx();
  return { deleted };
}

export interface EmptyPost {
  id: number;
  caption: string | null;
  author_name: string | null;
  created_at: string;
}

// Non-deleted posts that no longer hold a single image — either the owner
// removed them all, or every image was orphan-cleaned. They linger as blank
// cards in feeds and on the author's profile.
export function findEmptyPosts(): EmptyPost[] {
  return db
    .prepare(
      `SELECT p.id, p.caption, p.created_at,
              COALESCE(pc.username, u.email) AS author_name
         FROM posts p
         LEFT JOIN users u ON u.id = p.author_user_id
         LEFT JOIN post_creators pc ON pc.id = p.author_creator_id
        WHERE p.is_deleted = 0
          AND NOT EXISTS (SELECT 1 FROM post_media m WHERE m.post_id = p.id)
        ORDER BY p.id`
    )
    .all() as EmptyPost[];
}

// Soft-delete every post that currently holds no image, matching how posts are
// removed elsewhere (is_deleted = 1, never a hard row delete). Returns how many
// posts were removed.
export function purgeEmptyPosts(): { deleted: number } {
  const empties = findEmptyPosts();
  if (empties.length === 0) return { deleted: 0 };
  const softDelete = db.prepare("UPDATE posts SET is_deleted = 1 WHERE id = ?");
  const tx = db.transaction(() => {
    for (const p of empties) softDelete.run(p.id);
  });
  tx();
  return { deleted: empties.length };
}
