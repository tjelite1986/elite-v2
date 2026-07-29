import { db } from "./db";

// Non-destructive profile links. A "member" handle is displayed under a
// "primary" handle; both keep their own rows and sync independently. The unified
// profile page + people directory aggregate a group's content. One level only.

// Local copy of directory.handleOf to avoid a circular import (directory.ts
// imports from here). Same slug rule as the rest of the handle namespace.
function norm(name: string): string {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, "")
    .replace(/^[._]+|[._]+$/g, "");
}

// The face a handle is shown under: its primary if linked, else itself.
export function getPrimaryHandle(handle: string): string {
  const h = norm(handle);
  const row = db
    .prepare("SELECT primary_handle FROM profile_links WHERE member_handle = ?")
    .get(h) as { primary_handle: string } | undefined;
  return row ? row.primary_handle : h;
}

// All handles in a group (the primary plus its members). Pass any member or the
// primary — it resolves the primary first.
export function getGroupMembers(handle: string): string[] {
  const primary = getPrimaryHandle(handle);
  const rows = db
    .prepare("SELECT member_handle FROM profile_links WHERE primary_handle = ?")
    .all(primary) as { member_handle: string }[];
  return [primary, ...rows.map((r) => r.member_handle)];
}

export interface PersonContentIds {
  userIds: number[];
  creatorIds: number[];
  shortsMainIds: number[];
  shorts18Ids: number[];
}

// Stored usernames/names are not guaranteed to be normalized (imports and
// short profiles keep display-ish names), so matching must apply norm() to the
// stored value — a plain `WHERE username IN (...)` would miss rows. Registering
// norm() as a SQL function lets SQLite do that filtering without materializing
// every profile row in JS.
db.function("norm_handle", { deterministic: true }, (s) =>
  norm(String(s ?? ""))
);

// Resolve every content id (across all linked members) for a handle, so callers
// can union them in feed/count queries. 18+ short profiles are excluded unless
// include18.
export function personContentIds(
  handle: string,
  include18: boolean
): PersonContentIds {
  const members = getGroupMembers(handle);
  const ph = members.map(() => "?").join(", ");

  const userIds = (
    db
      .prepare(
        `SELECT user_id FROM user_profiles WHERE norm_handle(username) IN (${ph})`
      )
      .all(...members) as { user_id: number }[]
  ).map((r) => r.user_id);

  const creatorIds = (
    db
      .prepare(
        `SELECT id FROM post_creators WHERE norm_handle(username) IN (${ph})`
      )
      .all(...members) as { id: number }[]
  ).map((r) => r.id);

  const shorts = db
    .prepare(
      `SELECT id, channel FROM short_profiles WHERE norm_handle(name) IN (${ph})`
    )
    .all(...members) as { id: number; channel: string }[];
  const shortsMainIds: number[] = [];
  const shorts18Ids: number[] = [];
  for (const s of shorts) {
    if (s.channel === "18plus") {
      if (include18) shorts18Ids.push(s.id);
    } else {
      shortsMainIds.push(s.id);
    }
  }

  return { userIds, creatorIds, shortsMainIds, shorts18Ids };
}

// True if the handle is a non-primary member of some group (its profile page
// should canonicalise to the primary).
export function isLinkedMember(handle: string): boolean {
  const h = norm(handle);
  return (
    db
      .prepare("SELECT 1 FROM profile_links WHERE member_handle = ?")
      .get(h) !== undefined
  );
}

// Link member handles under a primary "face". Flattens one level: if a member
// was itself a primary, its members are re-pointed to the new primary; if a
// member was linked elsewhere, it is moved here. The primary is resolved to its
// own top-level face first so groups never nest.
export function linkProfiles(primaryHandle: string, memberHandles: string[]): void {
  const primary = getPrimaryHandle(primaryHandle);
  const tx = db.transaction(() => {
    for (const raw of memberHandles) {
      const member = norm(raw);
      if (!member || member === primary) continue;
      // Re-point any group this member currently leads onto the new primary.
      db.prepare(
        "UPDATE profile_links SET primary_handle = ? WHERE primary_handle = ?"
      ).run(primary, member);
      // Move/insert the member itself under the new primary.
      db.prepare(
        "INSERT INTO profile_links (member_handle, primary_handle) VALUES (?, ?) " +
          "ON CONFLICT(member_handle) DO UPDATE SET primary_handle = excluded.primary_handle"
      ).run(member, primary);
    }
  });
  tx();
}

// Remove a single member from its group (the member becomes standalone again).
export function unlinkProfile(memberHandle: string): void {
  db.prepare("DELETE FROM profile_links WHERE member_handle = ?").run(
    norm(memberHandle)
  );
}

// --- Aliases -------------------------------------------------------------
// An alias is just a profile_links member with (usually) no backing profile of
// its own: an alternate @handle/name that should resolve to a face. Sharing the
// profile_links table means a single resolution path (getPrimaryHandle /
// resolvePerson) serves both real linked profiles and bare name aliases — so a
// short or post whose title tags a mis-/alternate-spelled handle still links to
// the right profile.

// Alias handles pointing at a face (its primary). The primary itself is
// excluded — it is not its own alias.
export function listAliases(handle: string): string[] {
  const primary = getPrimaryHandle(handle);
  const rows = db
    .prepare(
      "SELECT member_handle FROM profile_links WHERE primary_handle = ? ORDER BY member_handle"
    )
    .all(primary) as { member_handle: string }[];
  return rows.map((r) => r.member_handle);
}

export type AddAliasResult =
  | { ok: true; alias: string }
  | { ok: false; error: string; status: 400 | 409 };

// Add one alias handle to a face. Guards against hijacking another identity:
// aliasing a real member account, or stealing a name already aliased to a
// different face, is rejected (409). Returns the normalized alias on success.
export function addAlias(handle: string, alias: string): AddAliasResult {
  const primary = getPrimaryHandle(handle);
  const member = norm(alias);
  if (!member || member === primary) {
    return {
      ok: false,
      error: "Enter a name that differs from this profile.",
      status: 400,
    };
  }
  if (member.length < 2 || member.length > 40) {
    return { ok: false, error: "Name must be 2–40 characters.", status: 400 };
  }
  // A real member account must not be folded under someone else's face.
  const userAcct = db
    .prepare("SELECT 1 FROM user_profiles WHERE norm_handle(username) = ?")
    .get(member);
  if (userAcct) {
    return {
      ok: false,
      error: "That name belongs to a member account.",
      status: 409,
    };
  }
  // A name that already belongs to an existing content-only profile (a shorts
  // creator folder or a post creator) must not be folded under someone else's
  // face either — same hijack, just via an import-created profile instead of a
  // real login account.
  const shortProfile = db
    .prepare("SELECT 1 FROM short_profiles WHERE norm_handle(name) = ?")
    .get(member);
  if (shortProfile) {
    return {
      ok: false,
      error: "That name belongs to an existing creator profile.",
      status: 409,
    };
  }
  const creatorProfile = db
    .prepare("SELECT 1 FROM post_creators WHERE norm_handle(username) = ?")
    .get(member);
  if (creatorProfile) {
    return {
      ok: false,
      error: "That name belongs to an existing creator profile.",
      status: 409,
    };
  }
  // A name already aliased to a different face can't be stolen.
  const existing = db
    .prepare("SELECT primary_handle FROM profile_links WHERE member_handle = ?")
    .get(member) as { primary_handle: string } | undefined;
  if (existing && existing.primary_handle !== primary) {
    return {
      ok: false,
      error: "That name is already an alias of another profile.",
      status: 409,
    };
  }
  linkProfiles(primary, [member]);
  return { ok: true, alias: member };
}

// Remove an alias from THIS face only — scoped so one profile's owner can't
// unlink an alias belonging to another profile.
export function removeAlias(handle: string, alias: string): void {
  const primary = getPrimaryHandle(handle);
  db.prepare(
    "DELETE FROM profile_links WHERE member_handle = ? AND primary_handle = ?"
  ).run(norm(alias), primary);
}

export interface LinkGroup {
  primary: string;
  members: string[];
}

// All link groups, for the admin management UI.
export function listLinkGroups(): LinkGroup[] {
  const rows = db
    .prepare(
      "SELECT member_handle, primary_handle FROM profile_links ORDER BY primary_handle, member_handle"
    )
    .all() as { member_handle: string; primary_handle: string }[];
  const groups = new Map<string, string[]>();
  for (const r of rows) {
    if (!groups.has(r.primary_handle)) groups.set(r.primary_handle, []);
    groups.get(r.primary_handle)!.push(r.member_handle);
  }
  return Array.from(groups.entries()).map(([primary, members]) => ({
    primary,
    members,
  }));
}
