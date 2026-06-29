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

// Resolve every content id (across all linked members) for a handle, so callers
// can union them in feed/count queries. 18+ short profiles are excluded unless
// include18.
export function personContentIds(
  handle: string,
  include18: boolean
): PersonContentIds {
  const members = new Set(getGroupMembers(handle));

  const users = db
    .prepare("SELECT user_id, username FROM user_profiles")
    .all() as { user_id: number; username: string }[];
  const userIds = users
    .filter((u) => members.has(norm(u.username)))
    .map((u) => u.user_id);

  const creators = db
    .prepare("SELECT id, username FROM post_creators")
    .all() as { id: number; username: string }[];
  const creatorIds = creators
    .filter((c) => members.has(norm(c.username)))
    .map((c) => c.id);

  const shorts = db
    .prepare("SELECT id, name, channel FROM short_profiles")
    .all() as { id: number; name: string; channel: string }[];
  const shortsMainIds: number[] = [];
  const shorts18Ids: number[] = [];
  for (const s of shorts) {
    if (!members.has(norm(s.name))) continue;
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
