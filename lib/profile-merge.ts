import { db } from "./db";
import { handleOf } from "./directory";

// Merge one mirrored profile into another, by handle. Files are never moved:
// post_media.storage_key / shorts.storage_key already include their folder, so
// re-pointing the foreign keys is enough — the media routes resolve the keys
// unchanged. Optionally rename the surviving profile to a new name.
//
// Restricted to mirrored creators (post_creators / short_profiles). Real user
// accounts are never merged or deleted.

interface CreatorRow {
  id: number;
  username: string;
}
interface ShortRow {
  id: number;
  name: string;
  channel: string;
}

function userExists(handle: string): boolean {
  const rows = db.prepare("SELECT username FROM user_profiles").all() as {
    username: string;
  }[];
  return rows.some((r) => handleOf(r.username) === handle);
}

function creatorByHandle(handle: string): CreatorRow | undefined {
  return db
    .prepare("SELECT id, username FROM post_creators WHERE username = ?")
    .get(handle) as CreatorRow | undefined;
}

function shortsByHandle(handle: string): Record<string, ShortRow> {
  const out: Record<string, ShortRow> = {};
  const rows = db
    .prepare("SELECT id, name, channel FROM short_profiles")
    .all() as ShortRow[];
  for (const r of rows) if (handleOf(r.name) === handle) out[r.channel] = r;
  return out;
}

// Move a handle-keyed row (avatar/extras) to the final handle if the final
// handle has none yet.
function migrateHandleRow(table: string, from: string, to: string) {
  if (from === to) return;
  const fromRow = db.prepare(`SELECT 1 FROM ${table} WHERE handle = ?`).get(from);
  if (!fromRow) return;
  const toRow = db.prepare(`SELECT 1 FROM ${table} WHERE handle = ?`).get(to);
  if (toRow) {
    db.prepare(`DELETE FROM ${table} WHERE handle = ?`).run(from);
  } else {
    db.prepare(`UPDATE ${table} SET handle = ? WHERE handle = ?`).run(to, from);
  }
}

export interface MergeResult {
  handle: string;
}

export function mergeProfiles(opts: {
  targetHandle: string;
  sourceHandle: string;
  newName?: string;
}): MergeResult {
  const target = handleOf(opts.targetHandle);
  const source = handleOf(opts.sourceHandle);
  if (!source || !target) throw new Error("Invalid handle.");
  if (source === target) throw new Error("Pick a different profile to merge.");

  if (userExists(source) || userExists(target)) {
    throw new Error("Real user accounts can't be merged.");
  }

  const sCreator = creatorByHandle(source);
  const tCreator = creatorByHandle(target);
  const sShorts = shortsByHandle(source);
  const tShorts = shortsByHandle(target);

  if (!sCreator && Object.keys(sShorts).length === 0) {
    throw new Error("That profile has no content to merge.");
  }

  const wantRename = Boolean(opts.newName && opts.newName.trim());
  const finalHandle = wantRename ? handleOf(opts.newName as string) : target;
  if (!finalHandle) throw new Error("Invalid new name.");
  // A rename can't collide with a *different* existing creator.
  if (wantRename && finalHandle !== target && finalHandle !== source) {
    const clash = creatorByHandle(finalHandle);
    if (clash) throw new Error("That name is already taken.");
  }

  const run = db.transaction(() => {
    // --- Photos (post_creators) ---
    let finalCreatorId = tCreator?.id ?? null;
    if (sCreator) {
      if (!finalCreatorId) {
        // No target creator — the source creator becomes the survivor.
        finalCreatorId = sCreator.id;
      } else {
        db.prepare(
          "UPDATE posts SET author_creator_id = ? WHERE author_creator_id = ?"
        ).run(finalCreatorId, sCreator.id);
        db.prepare(
          "UPDATE OR IGNORE follows SET target_id = ? WHERE target_type = 'creator' AND target_id = ?"
        ).run(finalCreatorId, sCreator.id);
        db.prepare(
          "DELETE FROM follows WHERE target_type = 'creator' AND target_id = ?"
        ).run(sCreator.id);
        db.prepare("DELETE FROM post_creators WHERE id = ?").run(sCreator.id);
      }
    }
    if (finalCreatorId) {
      db.prepare("UPDATE post_creators SET username = ? WHERE id = ?").run(
        finalHandle,
        finalCreatorId
      );
    }

    // --- Shorts (per channel) ---
    for (const ch of ["main", "18plus"]) {
      const s = sShorts[ch];
      const t = tShorts[ch];
      if (s) {
        if (!t) {
          db.prepare("UPDATE short_profiles SET name = ? WHERE id = ?").run(
            finalHandle,
            s.id
          );
        } else {
          db.prepare("UPDATE shorts SET profile_id = ? WHERE profile_id = ?").run(
            t.id,
            s.id
          );
          db.prepare(
            "UPDATE OR IGNORE follows SET target_id = ? WHERE target_type = 'shorts' AND target_id = ?"
          ).run(t.id, s.id);
          db.prepare(
            "DELETE FROM follows WHERE target_type = 'shorts' AND target_id = ?"
          ).run(s.id);
          db.prepare("DELETE FROM short_profiles WHERE id = ?").run(s.id);
        }
      }
      if (t) {
        db.prepare("UPDATE short_profiles SET name = ? WHERE id = ?").run(
          finalHandle,
          t.id
        );
      }
    }

    // --- Handle-keyed extras (avatar / bio-links-banner) ---
    for (const table of ["handle_avatars", "profile_extras"]) {
      migrateHandleRow(table, source, finalHandle);
      migrateHandleRow(table, target, finalHandle);
    }
  });
  run();

  return { handle: finalHandle };
}
