import { db } from "./db";

// A saved "smart album": a named filter that dynamically resolves to matching
// gallery items. Criteria combine with AND.
export interface SmartCriteria {
  tag?: string;
  minRating?: number; // 1..5
  favorite?: boolean;
  type?: "video"; // media kind
  gps?: boolean; // has location
  year?: number;
}

export interface SmartAlbum {
  id: number;
  name: string;
  criteria: SmartCriteria;
  created_at: string;
}

function sanitize(raw: unknown): SmartCriteria {
  const c = (raw ?? {}) as Record<string, unknown>;
  const out: SmartCriteria = {};
  if (typeof c.tag === "string" && c.tag.trim()) out.tag = c.tag.trim().slice(0, 40);
  if (Number.isInteger(c.minRating) && (c.minRating as number) >= 1 && (c.minRating as number) <= 5)
    out.minRating = c.minRating as number;
  if (c.favorite === true) out.favorite = true;
  if (c.type === "video") out.type = "video";
  if (c.gps === true) out.gps = true;
  if (Number.isInteger(c.year)) out.year = c.year as number;
  return out;
}

export function listSmartAlbums(userId: number): SmartAlbum[] {
  return (
    db
      .prepare(
        "SELECT id, name, criteria_json, created_at FROM smart_albums WHERE user_id = ? ORDER BY name"
      )
      .all(userId) as {
      id: number;
      name: string;
      criteria_json: string;
      created_at: string;
    }[]
  ).map((r) => {
    let criteria: SmartCriteria = {};
    try {
      criteria = sanitize(JSON.parse(r.criteria_json));
    } catch {
      /* ignore */
    }
    return { id: r.id, name: r.name, criteria, created_at: r.created_at };
  });
}

export function createSmartAlbum(
  userId: number,
  name: string,
  rawCriteria: unknown
): SmartAlbum | null {
  const trimmed = name.trim().slice(0, 80);
  const criteria = sanitize(rawCriteria);
  if (!trimmed || Object.keys(criteria).length === 0) return null;
  const result = db
    .prepare(
      "INSERT INTO smart_albums (user_id, name, criteria_json) VALUES (?, ?, ?)"
    )
    .run(userId, trimmed, JSON.stringify(criteria));
  return { id: Number(result.lastInsertRowid), name: trimmed, criteria, created_at: "" };
}

export function deleteSmartAlbum(userId: number, id: number): void {
  db.prepare("DELETE FROM smart_albums WHERE id = ? AND user_id = ?").run(id, userId);
}

export function getSmartAlbum(userId: number, id: number): SmartAlbum | null {
  return listSmartAlbums(userId).find((a) => a.id === id) ?? null;
}

// Resolve a smart album's criteria to the matching (non-deleted) items, in the
// same shape the gallery grid expects.
export function resolveSmartItems(userId: number, criteria: SmartCriteria) {
  const where: string[] = ["gi.user_id = ?", "gi.is_deleted = 0"];
  const args: unknown[] = [userId];
  if (criteria.minRating) {
    where.push("gi.rating >= ?");
    args.push(criteria.minRating);
  }
  if (criteria.favorite) where.push("gi.is_favorite = 1");
  if (criteria.type === "video") where.push("gi.mime_type LIKE 'video/%'");
  if (criteria.gps) where.push("gi.latitude IS NOT NULL AND gi.longitude IS NOT NULL");
  if (criteria.year) {
    where.push("strftime('%Y', gi.taken_at) = ?");
    args.push(String(criteria.year));
  }
  let join = "";
  if (criteria.tag) {
    join = "JOIN gallery_tags gt ON gt.item_id = gi.id AND gt.tag = ?";
    args.push(criteria.tag);
  }
  return db
    .prepare(
      `SELECT gi.id, gi.filename, gi.mime_type, gi.width, gi.height, gi.latitude,
              gi.longitude, gi.location_name, gi.camera, gi.media_version,
              gi.taken_at, gi.is_favorite, gi.rating, gi.is_deleted
       FROM gallery_items gi ${join}
       WHERE ${where.join(" AND ")}
       ORDER BY gi.taken_at DESC, gi.id DESC`
    )
    .all(...args);
}
