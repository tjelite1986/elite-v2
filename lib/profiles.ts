import { db, UserProfileRow } from "./db";
import { qb, getOne } from "./kysely";

// Shared public-profile layer (username/avatar/bio), 1:1 with users. The posts
// module attributes by these instead of splitting the email; other modules can
// adopt it later.
//
// Reads go through the typed Kysely builder; writes stay on raw better-sqlite3
// (single obvious write path — INSERT/UPDATE/upsert, incl. ON CONFLICT and
// dynamic column sets, where a query builder adds no safety).

const USERNAME_RE = /^[a-z0-9._]{2,30}$/;

// Slugify an arbitrary string (email local-part, display name) into a candidate
// username. Identical to the backfill rule in db.ts migrate().
export function slugifyUsername(base: string, fallbackId: number): string {
  const s = (base.split("@")[0] || `user${fallbackId}`)
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, "")
    .replace(/^[._]+|[._]+$/g, "")
    .slice(0, 30);
  return s || `user${fallbackId}`;
}

export function getProfileByUserId(userId: number): UserProfileRow | undefined {
  return getOne<UserProfileRow>(
    qb.selectFrom("user_profiles").selectAll().where("user_id", "=", userId)
  );
}

// True if the username already belongs to another account. It used to also
// check the creator handles, because accounts and the posts library's creators
// shared one namespace; that library became its own app on 2026-09-16 and took
// the creators with it.
export function usernameTaken(username: string, exceptUserId?: number): boolean {
  const handle = username.toLowerCase();
  const u = getOne<{ user_id: number }>(
    qb.selectFrom("user_profiles").select("user_id").where("username", "=", handle)
  );
  return Boolean(u && u.user_id !== exceptUserId);
}

// Create a profile for a user that lacks one (new registrations between boots),
// picking a free slug. Returns the existing or newly created row.
export function ensureUserProfile(
  userId: number,
  email: string
): UserProfileRow {
  const existing = getProfileByUserId(userId);
  if (existing) return existing;

  const base = slugifyUsername(email, userId);
  let username = base;
  let n = 1;
  while (usernameTaken(username)) username = `${base}${n++}`;
  db.prepare(
    "INSERT INTO user_profiles (user_id, username) VALUES (?, ?)"
  ).run(userId, username);
  return getProfileByUserId(userId)!;
}

export function isValidUsername(username: string): boolean {
  return USERNAME_RE.test(username);
}

// Update the username after validation. Returns an error string or null on ok.
export function setUsername(userId: number, username: string): string | null {
  const u = username.trim().toLowerCase();
  if (!isValidUsername(u)) {
    return "Username must be 2–30 chars: lowercase letters, numbers, dot, underscore.";
  }
  if (usernameTaken(u, userId)) return "That username is taken.";
  db.prepare("UPDATE user_profiles SET username = ? WHERE user_id = ?").run(
    u,
    userId
  );
  return null;
}

export function setProfileFields(
  userId: number,
  fields: { display_name?: string | null; bio?: string | null }
): void {
  const sets: string[] = [];
  const values: (string | null)[] = [];
  if (fields.display_name !== undefined) {
    sets.push("display_name = ?");
    values.push(fields.display_name?.slice(0, 80) || null);
  }
  if (fields.bio !== undefined) {
    sets.push("bio = ?");
    values.push(fields.bio?.slice(0, 500) || null);
  }
  if (sets.length === 0) return;
  values.push(String(userId));
  db.prepare(
    `UPDATE user_profiles SET ${sets.join(", ")} WHERE user_id = ?`
  ).run(...values);
}

export function setAvatarKey(userId: number, avatarKey: string): void {
  db.prepare("UPDATE user_profiles SET avatar_key = ? WHERE user_id = ?").run(
    avatarKey,
    userId
  );
}

// Handle-scoped avatar. Takes precedence over the legacy avatar_key column in
// the avatar route.

// Cross-section profile extras (bio / banner / labeled links), keyed by handle.

// A custom labeled profile field. `public` controls whether non-owners see it.

// Only http(s) links — reject javascript:/data: etc. (the url is rendered into
// an href, so a bad scheme would be stored XSS). Shared validator; user-typed
// links may omit the scheme, so https:// is prepended before validation.

// Convenience: set bio + links together (e.g. from the profile editor, which
// always submits both). The route uses the granular setters so a partial API
// update touches only the fields actually present.

// Free-text location (e.g. "Stockholm, Sweden"). Empty clears it.

// Set (or clear) the Instagram source + auto-poll flag for a profile. The
// instagram_handle is the IG username to pull from; pass null to disconnect.

// Set (or clear) the TikTok source + auto-poll flag for a profile. The
// tiktok_handle is the TikTok username to pull from; pass null to disconnect.
// Unlike Instagram, TikTok syncing does not require a session cookie.

// Per-user preference: surface 18+ content outside the dedicated 18+ section.
// Viewing still requires the PIN cookie; this only controls whether adult
// content is woven into general browsing.

export function setShowAdultOutside(userId: number, on: boolean): void {
  db.prepare(
    "UPDATE user_profiles SET show_adult_outside = ? WHERE user_id = ?"
  ).run(on ? 1 : 0, userId);
}

// Per-user preference: show the App Store in the menu and on the dashboard.
// Whether the account may reach the store at all is the `appstore` permission;
// this is only whether the person wants to see the way in. Default on, so a
// profile row that predates the column reads as visible.
export function getShowAppstore(userId: number): boolean {
  const row = getOne<{ show_appstore: number }>(
    qb
      .selectFrom("user_profiles")
      .select("show_appstore")
      .where("user_id", "=", userId)
  );
  return row ? Boolean(row.show_appstore) : true;
}

export function setShowAppstore(userId: number, on: boolean): void {
  db.prepare(
    "UPDATE user_profiles SET show_appstore = ? WHERE user_id = ?"
  ).run(on ? 1 : 0, userId);
}
