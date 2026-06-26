import { db } from "./db";

function normalizeTag(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, 40);
}

// Verify the item belongs to the user before mutating its tags.
function owns(userId: number, itemId: number): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM gallery_items WHERE id = ? AND user_id = ?")
      .get(itemId, userId)
  );
}

export function tagsForItem(itemId: number): string[] {
  return (
    db
      .prepare("SELECT tag FROM gallery_tags WHERE item_id = ? ORDER BY tag")
      .all(itemId) as { tag: string }[]
  ).map((r) => r.tag);
}

// Replace an item's full tag set.
export function setItemTags(
  userId: number,
  itemId: number,
  tags: string[]
): void {
  if (!owns(userId, itemId)) return;
  const clean = Array.from(
    new Set(tags.map(normalizeTag).filter(Boolean))
  ).slice(0, 30);
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM gallery_tags WHERE item_id = ?").run(itemId);
    const ins = db.prepare(
      "INSERT OR IGNORE INTO gallery_tags (item_id, tag) VALUES (?, ?)"
    );
    for (const t of clean) ins.run(itemId, t);
  });
  tx();
}

// Add one tag to many of the user's items (batch).
export function addTagToItems(
  userId: number,
  ids: number[],
  rawTag: string
): number {
  const tag = normalizeTag(rawTag);
  if (!tag || ids.length === 0) return 0;
  const owned = (
    db
      .prepare(
        `SELECT id FROM gallery_items WHERE user_id = ? AND id IN (${ids
          .map(() => "?")
          .join(",")})`
      )
      .all(userId, ...ids) as { id: number }[]
  ).map((r) => r.id);
  const ins = db.prepare(
    "INSERT OR IGNORE INTO gallery_tags (item_id, tag) VALUES (?, ?)"
  );
  const tx = db.transaction(() => {
    for (const id of owned) ins.run(id, tag);
  });
  tx();
  return owned.length;
}

// Item ids (owned by the user) carrying a given tag.
export function itemIdsByTag(userId: number, tag: string): number[] {
  return (
    db
      .prepare(
        `SELECT gt.item_id AS id FROM gallery_tags gt
         JOIN gallery_items gi ON gi.id = gt.item_id
         WHERE gi.user_id = ? AND gt.tag = ?`
      )
      .all(userId, normalizeTag(tag)) as { id: number }[]
  ).map((r) => r.id);
}

// All tags the user has, with how many of their non-deleted items carry each.
export function allTags(userId: number): { tag: string; count: number }[] {
  return db
    .prepare(
      `SELECT gt.tag AS tag, COUNT(*) AS count
       FROM gallery_tags gt
       JOIN gallery_items gi ON gi.id = gt.item_id
       WHERE gi.user_id = ? AND gi.is_deleted = 0
       GROUP BY gt.tag
       ORDER BY count DESC, gt.tag ASC`
    )
    .all(userId) as { tag: string; count: number }[];
}
