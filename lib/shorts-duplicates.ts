import { db, ShortChannel, ShortDupeStateRow } from "./db";
import { dismissPair } from "./media-dedup";
import { qb, getOne, getAll } from "./kysely";
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
  source_id: string | null;
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
  const rows = getAll<MemberRow>(
    qb
      .selectFrom("short_dupe_groups as g")
      .innerJoin("shorts as s", (join) =>
        join.onRef("s.id", "=", "g.short_id").on("s.is_deleted", "=", 0)
      )
      .leftJoin("short_profiles as p", "p.id", "s.profile_id")
      .select([
        "g.group_key",
        "g.channel",
        "g.match_type",
        "g.is_best",
        "g.quality_score",
        "s.id as short_id",
        "s.caption",
        "s.storage_key",
        "s.poster_key",
        "s.width",
        "s.height",
        "s.duration",
        "s.size_bytes",
        "s.status",
        "s.created_at",
        "s.source_id",
        "p.name as profile_name",
      ])
      .$if(!!channel, (q) => q.where("g.channel", "=", channel!))
      .orderBy("g.group_key")
      .orderBy("g.is_best", "desc")
      .orderBy("g.quality_score", "desc")
      .orderBy("s.id")
  );

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
      source_id: r.source_id,
    });
  }

  // A delete elsewhere can leave a group with a single surviving member; that's
  // no longer a duplicate, so drop it from the review list.
  //
  // Groups a human has judged are filtered here rather than at scan time,
  // because the scan rewrites this table from scratch on every run — a
  // judgement recorded against the table itself would not survive one pass.
  const dismissed = dismissedPairs();
  return Array.from(groups.values())
    .filter((g) => g.members.length > 1)
    .filter((g) => !isFullyDismissed(g, dismissed));
}

/** Every pair a reviewer has marked "not a duplicate", as "lo:hi" keys. */
function dismissedPairs(): Set<string> {
  const rows = db
    .prepare(
      "SELECT a_id, b_id FROM media_dupe_dismissals WHERE kind = 'short'"
    )
    .all() as { a_id: number; b_id: number }[];
  return new Set(rows.map((r) => `${r.a_id}:${r.b_id}`));
}

/**
 * A group disappears only when EVERY pair in it has been dismissed. A group of
 * three where one member really is a duplicate must keep offering that pair.
 */
function isFullyDismissed(group: DupeGroup, dismissed: Set<string>): boolean {
  const ids = group.members.map((m) => m.short_id);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const [lo, hi] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
      if (!dismissed.has(`${lo}:${hi}`)) return false;
    }
  }
  return true;
}

// Which channel each of the given clips actually lives in. Authorization has to
// be derived from the rows themselves: a channel named by the caller says
// nothing about which section the ids belong to. Ids with no live row are
// absent from the map, so a caller can tell "unknown" from "not permitted".
export function shortChannels(shortIds: number[]): Map<number, ShortChannel> {
  const ids = [...new Set(shortIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) return new Map();
  const rows = getAll<{ id: number; channel: ShortChannel }>(
    qb
      .selectFrom("shorts")
      .select(["id", "channel"])
      .where("id", "in", ids)
      .where("is_deleted", "=", 0)
  );
  return new Map(rows.map((r) => [r.id, r.channel]));
}

/** Mark a whole group as "not duplicates", so the scan stops offering it. */
export function dismissDupeGroup(shortIds: number[]): number {
  const ids = [...new Set(shortIds.filter((n) => Number.isInteger(n) && n > 0))];
  let pairs = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      dismissPair("short", ids[i], ids[j]);
      pairs++;
    }
  }
  return pairs;
}

export function getDupeState(): ShortDupeStateRow {
  const row = getOne<ShortDupeStateRow>(
    qb.selectFrom("short_dupe_state").selectAll().where("id", "=", 1)
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
  // Unlink only after the rows are committed. Deleting inside the transaction
  // means a rollback leaves a surviving row pointing at a file that is already
  // gone, and nothing can put it back; committing first can at worst leave an
  // orphan file, which a maintenance sweep finds and removes.
  const unlinkAfterCommit: {
    channel: ShortChannel;
    storageKey: string;
    posterKey: string | null;
  }[] = [];

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
      unlinkAfterCommit.push({
        channel: clip.channel,
        storageKey: clip.storage_key,
        posterKey: clip.poster_key,
      });
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
  // Reads before it writes: BEGIN IMMEDIATE so busy_timeout applies (see lib/db.ts).
  tx.immediate();
  for (const f of unlinkAfterCommit) {
    deleteShortFiles(f.channel, f.storageKey, f.posterKey);
  }

  return { deleted, skippedBest };
}
