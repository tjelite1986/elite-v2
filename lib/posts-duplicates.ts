import { db, PostDupeStateRow } from "./db";
import { deletePostImageFiles } from "./posts-storage";

// One image inside a duplicate group, with the details the review UI needs to
// compare quality at a glance.
export interface PostDupeMember {
  media_id: number;
  post_id: number;
  is_best: boolean;
  distance: number; // dHash Hamming to the kept image (0 = exact / the best)
  storage_key: string;
  width: number | null;
  height: number | null;
  author_name: string | null;
  position: number;
  post_media_count: number;
}

export interface PostDupeGroup {
  group_key: string;
  match_type: "exact" | "perceptual";
  members: PostDupeMember[];
}

interface MemberRow extends Omit<PostDupeMember, "is_best"> {
  group_key: string;
  match_type: "exact" | "perceptual";
  is_best: number;
}

// All duplicate groups, best image first within each group. The author name is
// resolved from whichever author owns the post (user or mirrored creator).
export function getPostDupeGroups(): PostDupeGroup[] {
  const rows = db
    .prepare(
      `SELECT g.group_key, g.match_type, g.is_best, g.quality_score, g.distance,
              pm.id AS media_id, pm.post_id, pm.storage_key,
              pm.width, pm.height, pm.position,
              COALESCE(up.username, pc.username) AS author_name,
              (SELECT COUNT(*) FROM post_media m2 WHERE m2.post_id = pm.post_id)
                AS post_media_count
         FROM post_dupe_groups g
         JOIN post_media pm ON pm.id = g.media_id
         JOIN posts p ON p.id = pm.post_id AND p.is_deleted = 0
         LEFT JOIN user_profiles up ON up.user_id = p.author_user_id
         LEFT JOIN post_creators pc ON pc.id = p.author_creator_id
        ORDER BY g.group_key, g.is_best DESC, g.quality_score DESC, pm.id`
    )
    .all() as MemberRow[];

  const groups = new Map<string, PostDupeGroup>();
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
      media_id: r.media_id,
      post_id: r.post_id,
      is_best: r.is_best === 1,
      distance: r.distance,
      storage_key: r.storage_key,
      width: r.width,
      height: r.height,
      author_name: r.author_name,
      position: r.position,
      post_media_count: r.post_media_count,
    });
  }

  // A delete elsewhere can leave a group with a single surviving member; that's
  // no longer a duplicate, so drop it from the review list.
  return Array.from(groups.values()).filter((g) => g.members.length > 1);
}

export function getPostDupeState(): PostDupeStateRow {
  const row = db
    .prepare("SELECT * FROM post_dupe_state WHERE id = 1")
    .get() as PostDupeStateRow | undefined;
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

// Delete the given duplicate images, remove their files, and clean up dupe-group
// rows. Any image may be chosen (including the suggested "best"), but a group is
// never wiped whole: if every member of a group is selected, its best image (or,
// failing a flag, its first) is auto-kept and reported in `keptBest`. A post that
// loses its last image is soft-deleted so it doesn't render as a broken empty
// post. Returns how many images were actually deleted.
export function deletePostDuplicates(mediaIds: number[]): {
  deleted: number;
  keptBest: number;
} {
  const ids = new Set(
    mediaIds.filter((n) => Number.isInteger(n) && n > 0)
  );
  if (ids.size === 0) return { deleted: 0, keptBest: 0 };

  const memberRows = db
    .prepare(
      "SELECT media_id, group_key, is_best FROM post_dupe_groups WHERE media_id IN (" +
        Array.from(ids).map(() => "?").join(",") +
        ")"
    )
    .all(...Array.from(ids)) as {
    media_id: number;
    group_key: string;
    is_best: number;
  }[];

  // Per touched group, if the whole group is selected, drop its best from the
  // deletion set so at least one image survives for comparison.
  const groupKeys = Array.from(new Set(memberRows.map((r) => r.group_key)));
  let keptBest = 0;
  for (const gk of groupKeys) {
    const all = db
      .prepare("SELECT media_id, is_best FROM post_dupe_groups WHERE group_key = ?")
      .all(gk) as { media_id: number; is_best: number }[];
    const allSelected = all.every((m) => ids.has(m.media_id));
    if (allSelected) {
      const keep =
        all.find((m) => m.is_best === 1)?.media_id ?? all[0]?.media_id;
      if (keep != null && ids.delete(keep)) keptBest++;
    }
  }

  const getMedia = db.prepare(
    "SELECT id, post_id, storage_key FROM post_media WHERE id = ?"
  );
  const deleteMedia = db.prepare("DELETE FROM post_media WHERE id = ?");
  const dropGroupRow = db.prepare(
    "DELETE FROM post_dupe_groups WHERE media_id = ?"
  );
  const countMedia = db.prepare(
    "SELECT COUNT(*) AS n FROM post_media WHERE post_id = ?"
  );
  const softDeletePost = db.prepare(
    "UPDATE posts SET is_deleted = 1 WHERE id = ?"
  );

  let deleted = 0;

  const tx = db.transaction(() => {
    for (const id of Array.from(ids)) {
      const media = getMedia.get(id) as
        | { id: number; post_id: number; storage_key: string }
        | undefined;
      if (!media) continue;
      deletePostImageFiles(media.storage_key);
      deleteMedia.run(id);
      dropGroupRow.run(id);
      deleted++;
      // If that was the post's last image, retire the now-empty post.
      const remaining = countMedia.get(media.post_id) as { n: number };
      if (remaining.n === 0) softDeletePost.run(media.post_id);
    }
    // Drop groups that no longer have at least two members to compare.
    db.prepare(
      `DELETE FROM post_dupe_groups
        WHERE group_key IN (
          SELECT group_key FROM post_dupe_groups
          GROUP BY group_key HAVING COUNT(*) < 2
        )`
    ).run();
  });
  tx();

  return { deleted, keptBest };
}

// Mark a group as "not duplicates": record every pairing among the given images
// so future perceptual scans never re-group them, and drop the group from the
// current results. Exact byte-identical matches reform regardless (they are the
// same file) — this is for fuzzy false positives like B&W-vs-colour or
// same-shoot frames. Returns how many images were dismissed.
export function ignorePostDupeGroup(mediaIds: number[]): { ignored: number } {
  const ids = Array.from(
    new Set(mediaIds.filter((n) => Number.isInteger(n) && n > 0))
  );
  if (ids.length < 2) return { ignored: 0 };

  const addPair = db.prepare(
    `INSERT INTO post_dupe_ignored (a_media_id, b_media_id)
     VALUES (?, ?) ON CONFLICT DO NOTHING`
  );
  const dropGroupRow = db.prepare(
    "DELETE FROM post_dupe_groups WHERE media_id = ?"
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
      `DELETE FROM post_dupe_groups
        WHERE group_key IN (
          SELECT group_key FROM post_dupe_groups
          GROUP BY group_key HAVING COUNT(*) < 2
        )`
    ).run();
  });
  tx();

  return { ignored: ids.length };
}
