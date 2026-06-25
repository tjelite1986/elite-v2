import fs from "node:fs";
import { db, ShortChannel } from "./db";
import { videoPathFor, deleteShortFiles } from "./shorts-storage";

// Library maintenance for shorts: find and remove "orphans" — rows whose video
// file no longer exists on disk (the file was deleted/moved on the host, but the
// DB row was left behind). An orphan still shows in feeds, grids and playlists,
// yet every play 404s. Unlike the duplicate scanner there's nothing to keep, so
// removing the row is always safe.

export interface OrphanShort {
  id: number;
  channel: ShortChannel;
  caption: string | null;
  profile_name: string | null;
  storage_key: string;
  poster_key: string | null;
  created_at: string;
}

// Non-deleted shorts whose resolved video path is missing on disk. One fs.stat
// per clip, so it's fast enough to run inline in the request (no detached job
// like the dupe scanner). Optional channel narrows the scan to one section.
export function findOrphanShorts(channel?: ShortChannel): OrphanShort[] {
  const rows = db
    .prepare(
      `SELECT s.id, s.channel, s.caption, s.storage_key, s.poster_key,
              s.created_at, p.name AS profile_name
         FROM shorts s
         LEFT JOIN short_profiles p ON p.id = s.profile_id
        WHERE s.is_deleted = 0 ${channel ? "AND s.channel = ?" : ""}
        ORDER BY s.id`
    )
    .all(...(channel ? [channel] : [])) as OrphanShort[];

  return rows.filter(
    (r) => !fs.existsSync(videoPathFor(r.channel, r.storage_key))
  );
}

// Soft-delete the given shorts, detach them from every playlist, and drop any
// duplicate-scan rows. Best-effort unlink of a leftover poster (the video is
// already gone). Re-checks each row is still a live, file-less orphan inside the
// transaction so a clip that reappeared isn't removed. Returns how many went.
export function cleanupOrphanShorts(ids: number[]): { deleted: number } {
  const clean = Array.from(
    new Set(ids.filter((n) => Number.isInteger(n) && n > 0))
  );
  if (clean.length === 0) return { deleted: 0 };

  const getClip = db.prepare(
    "SELECT id, channel, storage_key, poster_key FROM shorts WHERE id = ? AND is_deleted = 0"
  );
  const softDelete = db.prepare("UPDATE shorts SET is_deleted = 1 WHERE id = ?");
  const dropPlaylistItems = db.prepare(
    "DELETE FROM short_playlist_items WHERE short_id = ?"
  );
  const dropDupeRow = db.prepare(
    "DELETE FROM short_dupe_groups WHERE short_id = ?"
  );

  let deleted = 0;
  const tx = db.transaction(() => {
    for (const id of clean) {
      const clip = getClip.get(id) as
        | {
            id: number;
            channel: ShortChannel;
            storage_key: string;
            poster_key: string | null;
          }
        | undefined;
      if (!clip) continue;
      // Guard against a TOCTOU race: only remove a row whose file is still gone.
      if (fs.existsSync(videoPathFor(clip.channel, clip.storage_key))) continue;
      deleteShortFiles(clip.channel, clip.storage_key, clip.poster_key);
      softDelete.run(id);
      dropPlaylistItems.run(id);
      dropDupeRow.run(id);
      deleted++;
    }
  });
  tx();
  return { deleted };
}

export interface EmptyPlaylist {
  id: number;
  name: string;
  user_email: string | null;
}

// Playlists that no longer hold a single visible (non-deleted) short — either
// the owner emptied them, or every clip in them was deleted/orphan-cleaned. They
// linger in the playlists list with a 0 count and no cover.
export function findEmptyPlaylists(): EmptyPlaylist[] {
  return db
    .prepare(
      `SELECT pl.id, pl.name, u.email AS user_email
         FROM short_playlists pl
         LEFT JOIN users u ON u.id = pl.user_id
        WHERE NOT EXISTS (
          SELECT 1 FROM short_playlist_items pi
          JOIN shorts s ON s.id = pi.short_id AND s.is_deleted = 0
          WHERE pi.playlist_id = pl.id
        )
        ORDER BY pl.id`
    )
    .all() as EmptyPlaylist[];
}

// Delete every playlist that currently holds no visible short. The ON DELETE
// CASCADE on short_playlist_items clears any stale item rows pointing at
// already-removed clips. Returns how many playlists were removed.
export function purgeEmptyPlaylists(): { deleted: number } {
  const empties = findEmptyPlaylists();
  if (empties.length === 0) return { deleted: 0 };
  const del = db.prepare("DELETE FROM short_playlists WHERE id = ?");
  const tx = db.transaction(() => {
    for (const p of empties) del.run(p.id);
  });
  tx();
  return { deleted: empties.length };
}
