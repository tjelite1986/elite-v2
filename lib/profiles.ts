import { db, UserProfileRow } from "./db";

// Shared public-profile layer (username/avatar/bio), 1:1 with users. The posts
// module attributes by these instead of splitting the email; other modules can
// adopt it later.

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
  return db
    .prepare("SELECT * FROM user_profiles WHERE user_id = ?")
    .get(userId) as UserProfileRow | undefined;
}

export function getProfileByUsername(
  username: string
): UserProfileRow | undefined {
  return db
    .prepare("SELECT * FROM user_profiles WHERE username = ?")
    .get(username.toLowerCase()) as UserProfileRow | undefined;
}

// True if the username is already taken by a user OR a creator (the two share a
// handle namespace so @name is unambiguous across the feed).
export function usernameTaken(username: string, exceptUserId?: number): boolean {
  const u = db
    .prepare("SELECT user_id FROM user_profiles WHERE username = ?")
    .get(username.toLowerCase()) as { user_id: number } | undefined;
  if (u && u.user_id !== exceptUserId) return true;
  const c = db
    .prepare("SELECT id FROM post_creators WHERE username = ?")
    .get(username.toLowerCase());
  return Boolean(c);
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
