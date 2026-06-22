import { db } from "./db";
import { qb, getOne } from "./kysely";

// A viewer may see a gallery item if they own it, or if it was shared with them
// (or by them) in a message attachment. Attachment ids are snapshotted into
// `messages.attachment_data` as JSON `{ ids: number[] }`.
export function canViewItem(viewerId: number, itemId: number): boolean {
  const owned = getOne(
    qb
      .selectFrom("gallery_items")
      .select("id")
      .where("id", "=", itemId)
      .where("user_id", "=", viewerId)
  );
  if (owned) return true;

  // The shared-via-message check uses SQLite's json_each table-valued function,
  // which the query builder can't express — kept as raw SQL.

  const shared = db
    .prepare(
      `SELECT 1
       FROM (
         SELECT attachment_data FROM messages
         WHERE attachment_data IS NOT NULL
           AND (sender_id = @v OR recipient_id = @v)
       ) m, json_each(m.attachment_data, '$.ids') je
       WHERE je.value = @item
       LIMIT 1`
    )
    .get({ v: viewerId, item: itemId });
  return !!shared;
}
