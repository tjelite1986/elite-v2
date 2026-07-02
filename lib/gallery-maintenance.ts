import fs from "node:fs";
import { db } from "./db";
import { originalPathFor, deleteMediaFiles } from "./gallery-storage";
import { PROFILE_ROOT, storageRootAvailable } from "./storage-roots";

// Library maintenance for the gallery, mirroring lib/posts-maintenance.ts.
// Gallery items are standalone (no parent "post"), so there's only one kind of
// dead entry to chase: an "orphan item" — a gallery_items row whose original
// file is gone from disk. The thumbnail might still render in the grid but every
// full load 404s; there's nothing to keep, so dropping the row is always safe.
// The gallery is per user, so each item's file is resolved against its owner.

export interface OrphanItem {
  id: number; // gallery_items.id
  user_id: number;
  filename: string;
  storage_key: string;
  owner_name: string | null;
  taken_at: string;
}

// Non-trashed items whose resolved original path is missing on disk. One
// fs.stat per item, so it's fast enough to run inline in the request (no
// detached job like the dupe scanner).
export function findOrphanGalleryItems(): OrphanItem[] {
  // If the media root is missing or empty the volume is almost certainly not
  // mounted — every row would look like an orphan, and the hourly cleanup job
  // would hard-delete the whole library. Report nothing instead.
  if (!storageRootAvailable(PROFILE_ROOT)) {
    console.error(
      `[gallery-maintenance] storage root missing or empty, skipping orphan scan: ${PROFILE_ROOT}`
    );
    return [];
  }
  const rows = db
    .prepare(
      `SELECT gi.id, gi.user_id, gi.filename, gi.storage_key, gi.taken_at,
              up.username AS owner_name
         FROM gallery_items gi
         LEFT JOIN user_profiles up ON up.user_id = gi.user_id
        WHERE gi.is_deleted = 0
        ORDER BY gi.id`
    )
    .all() as OrphanItem[];

  return rows.filter(
    (r) => !fs.existsSync(originalPathFor(r.user_id, r.storage_key))
  );
}

// Delete the given item rows and unlink any straggler derivative files (the
// original is already gone; thumb/preview may linger). The ON DELETE CASCADE on
// gallery_dupe_groups / gallery_media_fp clears their rows. Re-checks each row is
// still a live, file-less orphan inside the transaction so an item whose file
// reappeared isn't removed. Returns how many went.
export function cleanupOrphanGalleryItems(ids: number[]): { deleted: number } {
  const clean = Array.from(
    new Set(ids.filter((n) => Number.isInteger(n) && n > 0))
  );
  if (clean.length === 0) return { deleted: 0 };

  // Same unmounted-volume guard as the scan, plus a blast-radius cap: deleting
  // more than 20% of a non-trivial library in one sweep is far more likely a
  // mount problem than genuine rot — refuse and leave the rows for a human.
  if (!storageRootAvailable(PROFILE_ROOT)) {
    console.error(
      `[gallery-maintenance] storage root missing or empty, refusing cleanup: ${PROFILE_ROOT}`
    );
    return { deleted: 0 };
  }
  const total = (
    db
      .prepare("SELECT COUNT(*) AS n FROM gallery_items WHERE is_deleted = 0")
      .get() as { n: number }
  ).n;
  if (clean.length > 20 && clean.length > total * 0.2) {
    console.error(
      `[gallery-maintenance] refusing to delete ${clean.length} of ${total} items (>20%) — storage mount problem?`
    );
    return { deleted: 0 };
  }

  const getItem = db.prepare(
    `SELECT id, user_id, storage_key
       FROM gallery_items
      WHERE id = ? AND is_deleted = 0`
  );
  const delItem = db.prepare("DELETE FROM gallery_items WHERE id = ?");

  let deleted = 0;
  const tx = db.transaction(() => {
    for (const id of clean) {
      const item = getItem.get(id) as
        | { id: number; user_id: number; storage_key: string }
        | undefined;
      if (!item) continue;
      // Guard against a TOCTOU race: only remove a row whose file is still gone.
      if (fs.existsSync(originalPathFor(item.user_id, item.storage_key))) continue;
      deleteMediaFiles(item.user_id, item.storage_key);
      delItem.run(id);
      deleted++;
    }
  });
  tx();
  return { deleted };
}
