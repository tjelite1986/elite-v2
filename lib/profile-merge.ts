import { db } from "./db";
import { qb, getOne, getAll } from "./kysely";
import { handleOf } from "./directory";

// Merge one mirrored profile into another, by handle. Files are never moved:
// post_media.storage_key already includes its folder, so re-pointing the foreign
// keys is enough — the media routes resolve the keys unchanged. Optionally
// rename the surviving profile to a new name.
//
// Restricted to mirrored creators (post_creators). Real user accounts are never
// merged or deleted.

interface CreatorRow {
  id: number;
  username: string;
}
// Reads use the typed Kysely builder. The merge itself (below) stays raw SQL:
// it runs inside a db.transaction() with SQLite-specific UPDATE OR IGNORE and a
// dynamic-table helper — none of which a compile-only query builder helps with.
function userExists(handle: string): boolean {
  const rows = getAll<{ username: string }>(
    qb.selectFrom("user_profiles").select("username")
  );
  return rows.some((r) => handleOf(r.username) === handle);
}

function creatorByHandle(handle: string): CreatorRow | undefined {
  return getOne<CreatorRow>(
    qb
      .selectFrom("post_creators")
      .select(["id", "username"])
      .where("username", "=", handle)
  );
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

  if (!sCreator) {
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

    // --- Handle-keyed extras (avatar / bio-links-banner) ---
    for (const table of ["handle_avatars", "profile_extras"]) {
      migrateHandleRow(table, source, finalHandle);
      migrateHandleRow(table, target, finalHandle);
    }
  });
  run();

  return { handle: finalHandle };
}
