import { sql } from "kysely";
import { db, GalleryDupeStateRow } from "./db";
import { qb, getOne, getAll } from "./kysely";

// One image inside a duplicate group, with the details the review UI needs to
// compare quality at a glance. The gallery is per user, so each member also
// carries its owner so the UI can show whose photo it is.
export interface GalleryDupeMember {
  item_id: number;
  user_id: number;
  is_best: boolean;
  distance: number; // dHash Hamming to the kept image (0 = exact / the best)
  storage_key: string;
  width: number | null;
  height: number | null;
  owner_name: string | null;
}

export interface GalleryDupeGroup {
  group_key: string;
  match_type: "exact" | "perceptual";
  members: GalleryDupeMember[];
}

interface MemberRow extends Omit<GalleryDupeMember, "is_best"> {
  group_key: string;
  match_type: "exact" | "perceptual";
  is_best: number;
}

// All duplicate groups, best image first within each group. The owner name is
// resolved from the gallery item's user. Items sent to trash (is_deleted = 1)
// are excluded, so a group that drops below two members no longer shows.
export function getGalleryDupeGroups(): GalleryDupeGroup[] {
  const rows = getAll<MemberRow>(
    qb
      .selectFrom("gallery_dupe_groups as g")
      .innerJoin("gallery_items as gi", (join) =>
        join.onRef("gi.id", "=", "g.item_id").on("gi.is_deleted", "=", 0)
      )
      .leftJoin("user_profiles as up", "up.user_id", "gi.user_id")
      .select([
        "g.group_key",
        "g.match_type",
        "g.is_best",
        "g.quality_score",
        "g.distance",
        "gi.id as item_id",
        "gi.user_id",
        "gi.storage_key",
        "gi.width",
        "gi.height",
        sql<string | null>`up.username`.as("owner_name"),
      ])
      .orderBy("g.group_key")
      .orderBy("g.is_best", "desc")
      .orderBy("g.quality_score", "desc")
      .orderBy("gi.id")
  );

  const groups = new Map<string, GalleryDupeGroup>();
  for (const r of rows) {
    let group = groups.get(r.group_key);
    if (!group) {
      group = {
        group_key: r.group_key,
        match_type: r.match_type,
        members: [],
      };
      groups.set(r.group_key, group);
    }
    group.members.push({
      item_id: r.item_id,
      user_id: r.user_id,
      is_best: r.is_best === 1,
      distance: r.distance,
      storage_key: r.storage_key,
      width: r.width,
      height: r.height,
      owner_name: r.owner_name,
    });
  }

  // A trash/delete elsewhere can leave a group with a single surviving member;
  // that's no longer a duplicate, so drop it from the review list.
  return Array.from(groups.values()).filter((g) => g.members.length > 1);
}

export function getGalleryDupeState(): GalleryDupeStateRow {
  const row = getOne<GalleryDupeStateRow>(
    qb.selectFrom("gallery_dupe_state").selectAll().where("id", "=", 1)
  );
  return (
    row ?? {
      id: 1,
      status: "idle",
      started_at: null,
      finished_at: null,
      scanned: 0,
      groups: 0,
      message: null,
    }
  );
}

// Trash the given duplicate items and clean up dupe-group rows. Any image may be
// chosen (including the suggested "best"), but a group is never wiped whole: if
// every member of a group is selected, its best image (or, failing a flag, its
// first) is auto-kept and reported in `keptBest`. Items are sent to the gallery
// trash (is_deleted = 1) rather than hard-deleted, matching how the gallery
// removes photos everywhere else — the owner can still restore them. Returns how
// many items were actually trashed.
export function deleteGalleryDuplicates(itemIds: number[]): {
  deleted: number;
  keptBest: number;
} {
  const ids = new Set(itemIds.filter((n) => Number.isInteger(n) && n > 0));
  if (ids.size === 0) return { deleted: 0, keptBest: 0 };

  const memberRows = getAll<{
    item_id: number;
    group_key: string;
    is_best: number;
  }>(
    qb
      .selectFrom("gallery_dupe_groups")
      .select(["item_id", "group_key", "is_best"])
      .where("item_id", "in", Array.from(ids))
  );

  // Per touched group, if the whole group is selected, drop its best from the
  // deletion set so at least one image survives for comparison.
  const groupKeys = Array.from(new Set(memberRows.map((r) => r.group_key)));
  let keptBest = 0;
  for (const gk of groupKeys) {
    const all = getAll<{ item_id: number; is_best: number }>(
      qb
        .selectFrom("gallery_dupe_groups")
        .select(["item_id", "is_best"])
        .where("group_key", "=", gk)
    );
    const allSelected = all.every((m) => ids.has(m.item_id));
    if (allSelected) {
      const keep =
        all.find((m) => m.is_best === 1)?.item_id ?? all[0]?.item_id;
      if (keep != null && ids.delete(keep)) keptBest++;
    }
  }

  const getItem = db.prepare(
    "SELECT id FROM gallery_items WHERE id = ? AND is_deleted = 0"
  );
  const trashItem = db.prepare(
    "UPDATE gallery_items SET is_deleted = 1, deleted_at = datetime('now') WHERE id = ?"
  );
  const dropGroupRow = db.prepare(
    "DELETE FROM gallery_dupe_groups WHERE item_id = ?"
  );

  let deleted = 0;

  const tx = db.transaction(() => {
    for (const id of Array.from(ids)) {
      const item = getItem.get(id) as { id: number } | undefined;
      if (!item) continue;
      trashItem.run(id);
      dropGroupRow.run(id);
      deleted++;
    }
    // Drop groups that no longer have at least two members to compare.
    db.prepare(
      `DELETE FROM gallery_dupe_groups
        WHERE group_key IN (
          SELECT group_key FROM gallery_dupe_groups
          GROUP BY group_key HAVING COUNT(*) < 2
        )`
    ).run();
  });
  tx();

  return { deleted, keptBest };
}

// Mark a group as "not duplicates": record every pairing among the given items
// so future perceptual scans never re-group them, and drop the group from the
// current results. Exact byte-identical matches reform regardless (they are the
// same file) — this is for fuzzy false positives like B&W-vs-colour or
// same-shoot frames. Returns how many items were dismissed.
export function ignoreGalleryDupeGroup(itemIds: number[]): { ignored: number } {
  const ids = Array.from(
    new Set(itemIds.filter((n) => Number.isInteger(n) && n > 0))
  );
  if (ids.length < 2) return { ignored: 0 };

  const addPair = db.prepare(
    `INSERT INTO gallery_dupe_ignored (a_item_id, b_item_id)
     VALUES (?, ?) ON CONFLICT DO NOTHING`
  );
  const dropGroupRow = db.prepare(
    "DELETE FROM gallery_dupe_groups WHERE item_id = ?"
  );

  const tx = db.transaction(() => {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = Math.min(ids[i], ids[j]);
        const b = Math.max(ids[i], ids[j]);
        addPair.run(a, b);
      }
    }
    for (const id of ids) dropGroupRow.run(id);
    // Clean up any group left with a single member after the dismissal.
    db.prepare(
      `DELETE FROM gallery_dupe_groups
        WHERE group_key IN (
          SELECT group_key FROM gallery_dupe_groups
          GROUP BY group_key HAVING COUNT(*) < 2
        )`
    ).run();
  });
  tx();

  return { ignored: ids.length };
}
