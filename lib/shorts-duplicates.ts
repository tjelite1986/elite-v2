import { db, ShortChannel, ShortDupeStateRow } from "./db";
import { deleteShortFiles } from "./shorts-storage";

// One clip inside a duplicate group, with the details the review UI needs to
// compare quality at a glance.
export interface DupeMember {
  short_id: number;
  is_best: boolean;
  channel: ShortChannel;
  caption: string | null;
  profile_name: string | null;
  storage_key: string;
  poster_key: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  size_bytes: number;
  status: string;
  created_at: string;
}

export interface DupeGroup {
  group_key: string;
  channel: ShortChannel;
  match_type: "exact" | "perceptual";
  members: DupeMember[];
}

interface MemberRow extends Omit<DupeMember, "is_best"> {
  group_key: string;
  match_type: "exact" | "perceptual";
  is_best: number;
}

// All duplicate groups for a channel, best clip first within each group.
export function getDupeGroups(channel?: ShortChannel): DupeGroup[] {
  const rows = db
    .prepare(
      `SELECT g.group_key, g.channel, g.match_type, g.is_best, g.quality_score,
              s.id AS short_id, s.caption, s.storage_key, s.poster_key,
              s.width, s.height, s.duration, s.size_bytes, s.status, s.created_at,
              p.name AS profile_name
         FROM short_dupe_groups g
         JOIN shorts s ON s.id = g.short_id AND s.is_deleted = 0
         LEFT JOIN short_profiles p ON p.id = s.profile_id
        ${channel ? "WHERE g.channel = @channel" : ""}
        ORDER BY g.group_key, g.is_best DESC, g.quality_score DESC, s.id`
    )
    .all(channel ? { channel } : {}) as MemberRow[];

  const groups = new Map<string, DupeGroup>();
  for (const r of rows) {
    let group = groups.get(r.group_key);
    if (!group) {
      group = {
        group_key: r.group_key,
        channel: r.channel,
        match_type: r.match_type,
        members: [],
      };
      groups.set(r.group_key, group);
    }
    group.members.push({
      short_id: r.short_id,
      is_best: r.is_best === 1,
      channel: r.channel,
      caption: r.caption,
      profile_name: r.profile_name,
      storage_key: r.storage_key,
      poster_key: r.poster_key,
      width: r.width,
      height: r.height,
      duration: r.duration,
      size_bytes: r.size_bytes,
      status: r.status,
      created_at: r.created_at,
    });
  }

  // A delete elsewhere can leave a group with a single surviving member; that's
  // no longer a duplicate, so drop it from the review list.
  return Array.from(groups.values()).filter((g) => g.members.length > 1);
}

export function getDupeState(): ShortDupeStateRow {
  const row = db
    .prepare("SELECT * FROM short_dupe_state WHERE id = 1")
    .get() as ShortDupeStateRow | undefined;
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

// Soft-delete the given clips, remove their files, and clean up dupe-group rows.
// Returns how many clips were actually deleted. Refuses to delete a clip that is
// the kept "best" of its group, so the caller can't accidentally drop all of a
// group's members.
export function deleteDuplicates(shortIds: number[]): {
  deleted: number;
  skippedBest: number;
} {
  const ids = Array.from(
    new Set(shortIds.filter((n) => Number.isInteger(n) && n > 0))
  );
  if (ids.length === 0) return { deleted: 0, skippedBest: 0 };

  const getClip = db.prepare(
    "SELECT id, channel, storage_key, poster_key FROM shorts WHERE id = ? AND is_deleted = 0"
  );
  const isBest = db.prepare(
    "SELECT 1 FROM short_dupe_groups WHERE short_id = ? AND is_best = 1 LIMIT 1"
  );
  const softDelete = db.prepare("UPDATE shorts SET is_deleted = 1 WHERE id = ?");
  const dropGroupRow = db.prepare(
    "DELETE FROM short_dupe_groups WHERE short_id = ?"
  );

  let deleted = 0;
  let skippedBest = 0;

  const tx = db.transaction(() => {
    for (const id of ids) {
      if (isBest.get(id)) {
        skippedBest++;
        continue;
      }
      const clip = getClip.get(id) as
        | { id: number; channel: ShortChannel; storage_key: string; poster_key: string | null }
        | undefined;
      if (!clip) continue;
      deleteShortFiles(clip.channel, clip.storage_key, clip.poster_key);
      softDelete.run(id);
      dropGroupRow.run(id);
      deleted++;
    }
    // Drop groups that no longer have at least two members to compare.
    db.prepare(
      `DELETE FROM short_dupe_groups
        WHERE group_key IN (
          SELECT group_key FROM short_dupe_groups
          GROUP BY group_key HAVING COUNT(*) < 2
        )`
    ).run();
  });
  tx();

  return { deleted, skippedBest };
}
