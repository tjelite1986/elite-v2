import { randomBytes } from "crypto";
import { db } from "./db";

// Public (no-auth) album share links, addressed by an opaque token.

export interface SharedAlbum {
  album_id: number;
  name: string;
  owner_id: number;
}

export interface SharedItem {
  id: number;
  filename: string;
  mime_type: string;
  width: number | null;
  height: number | null;
  media_version: number;
}

function ownsAlbum(albumId: number, userId: number): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM gallery_albums WHERE id = ? AND user_id = ?")
      .get(albumId, userId)
  );
}

// Get the existing share token for an album (owner only), or null.
export function getShareToken(albumId: number, userId: number): string | null {
  if (!ownsAlbum(albumId, userId)) return null;
  const row = db
    .prepare("SELECT token FROM album_shares WHERE album_id = ?")
    .get(albumId) as { token: string } | undefined;
  return row?.token ?? null;
}

// Create (or reuse) a share token for an album the user owns.
export function createShareToken(
  albumId: number,
  userId: number
): string | null {
  if (!ownsAlbum(albumId, userId)) return null;
  const existing = getShareToken(albumId, userId);
  if (existing) return existing;
  const token = randomBytes(12).toString("base64url");
  db.prepare(
    "INSERT INTO album_shares (token, album_id, created_by) VALUES (?, ?, ?)"
  ).run(token, albumId, userId);
  return token;
}

export function revokeShare(albumId: number, userId: number): void {
  if (!ownsAlbum(albumId, userId)) return;
  db.prepare("DELETE FROM album_shares WHERE album_id = ?").run(albumId);
}

// Resolve a public token to its album (or null if the link is invalid/revoked).
export function resolveShare(token: string): SharedAlbum | null {
  const row = db
    .prepare(
      `SELECT s.album_id AS album_id, a.name AS name, a.user_id AS owner_id
       FROM album_shares s
       JOIN gallery_albums a ON a.id = s.album_id
       WHERE s.token = ?`
    )
    .get(token) as SharedAlbum | undefined;
  return row ?? null;
}

// Non-deleted items in the shared album (public-safe fields only).
export function sharedItems(albumId: number): SharedItem[] {
  return db
    .prepare(
      `SELECT gi.id, gi.filename, gi.mime_type, gi.width, gi.height, gi.media_version
       FROM gallery_album_items ai
       JOIN gallery_items gi ON gi.id = ai.item_id
       WHERE ai.album_id = ? AND gi.is_deleted = 0
       ORDER BY gi.taken_at DESC, gi.id DESC`
    )
    .all(albumId) as SharedItem[];
}

// For serving media: confirm an item belongs to the shared album, returning the
// owner id + storage key needed to locate the file. Null if not part of it.
export function sharedItemFile(
  token: string,
  itemId: number
): { owner_id: number; storage_key: string; mime_type: string } | null {
  const share = resolveShare(token);
  if (!share) return null;
  const row = db
    .prepare(
      `SELECT gi.user_id AS owner_id, gi.storage_key, gi.mime_type
       FROM gallery_album_items ai
       JOIN gallery_items gi ON gi.id = ai.item_id
       WHERE ai.album_id = ? AND ai.item_id = ? AND gi.is_deleted = 0`
    )
    .get(share.album_id, itemId) as
    | { owner_id: number; storage_key: string; mime_type: string }
    | undefined;
  return row ?? null;
}
