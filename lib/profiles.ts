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

export function getProfileByUsername(
  username: string
): UserProfileRow | undefined {
  return getOne<UserProfileRow>(
    qb
      .selectFrom("user_profiles")
      .selectAll()
      .where("username", "=", username.toLowerCase())
  );
}

// True if the username is already taken by a user OR a creator (the two share a
// handle namespace so @name is unambiguous across the feed).
export function usernameTaken(username: string, exceptUserId?: number): boolean {
  const handle = username.toLowerCase();
  const u = getOne<{ user_id: number }>(
    qb.selectFrom("user_profiles").select("user_id").where("username", "=", handle)
  );
  if (u && u.user_id !== exceptUserId) return true;
  const c = getOne(
    qb.selectFrom("post_creators").select("id").where("username", "=", handle)
  );
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

// Handle-scoped avatar (works for any identity type, incl. video-only creators
// with no post_creators row). Takes precedence over the legacy avatar_key
// columns in the avatar route.
export function setHandleAvatar(handle: string, avatarKey: string): void {
  db.prepare(
    `INSERT INTO handle_avatars (handle, avatar_key, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(handle) DO UPDATE SET avatar_key = excluded.avatar_key, updated_at = datetime('now')`
  ).run(handle, avatarKey);
}

export function getHandleAvatar(handle: string): string | null {
  const row = getOne<{ avatar_key: string }>(
    qb
      .selectFrom("handle_avatars")
      .select("avatar_key")
      .where("handle", "=", handle)
  );
  return row?.avatar_key ?? null;
}

// Cross-section profile extras (bio / banner / labeled links), keyed by handle.
export interface ProfileLink {
  label: string;
  url: string;
}
// A custom labeled profile field. `public` controls whether non-owners see it.
export interface ProfileField {
  label: string;
  value: string;
  public: boolean;
}
export interface ProfileExtras {
  bio: string | null;
  links: ProfileLink[];
  fields: ProfileField[];
  location: string | null;
  banner_key: string | null;
  instagramHandle: string | null;
  igAutoPoll: boolean;
  igLastSyncedAt: string | null;
  igLastSyncError: string | null;
  igSyncing: boolean;
}

export function getProfileExtras(handle: string): ProfileExtras | null {
  const row = getOne<{
    bio: string | null;
    links_json: string | null;
    fields_json: string | null;
    location: string | null;
    banner_key: string | null;
    instagram_handle: string | null;
    ig_auto_poll: number;
    ig_last_synced_at: string | null;
    ig_last_sync_error: string | null;
    ig_syncing: number;
  }>(
    qb
      .selectFrom("profile_extras")
      .select([
        "bio",
        "links_json",
        "fields_json",
        "location",
        "banner_key",
        "instagram_handle",
        "ig_auto_poll",
        "ig_last_synced_at",
        "ig_last_sync_error",
        "ig_syncing",
      ])
      .where("handle", "=", handle)
  );
  if (!row) return null;
  let links: ProfileLink[] = [];
  try {
    const parsed = row.links_json ? JSON.parse(row.links_json) : [];
    if (Array.isArray(parsed)) {
      links = parsed
        .filter((l) => l && typeof l.url === "string")
        .map((l) => ({ label: String(l.label || "").slice(0, 40), url: String(l.url).slice(0, 300) }));
    }
  } catch {
    /* bad json -> no links */
  }
  let fields: ProfileField[] = [];
  try {
    const parsed = row.fields_json ? JSON.parse(row.fields_json) : [];
    if (Array.isArray(parsed)) {
      fields = parsed
        .filter((f) => f && typeof f.label === "string" && typeof f.value === "string")
        .map((f) => ({
          label: String(f.label).slice(0, 40),
          value: String(f.value).slice(0, 200),
          public: Boolean(f.public),
        }));
    }
  } catch {
    /* bad json -> no fields */
  }
  return {
    bio: row.bio,
    links,
    fields,
    location: row.location,
    banner_key: row.banner_key,
    instagramHandle: row.instagram_handle,
    igAutoPoll: !!row.ig_auto_poll,
    igLastSyncedAt: row.ig_last_synced_at,
    igLastSyncError: row.ig_last_sync_error,
    igSyncing: !!row.ig_syncing,
  };
}

function upsertExtras(handle: string, fields: Record<string, string | null>) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  db.prepare(
    `INSERT INTO profile_extras (handle, ${keys.join(", ")}, updated_at)
     VALUES (?, ${keys.map(() => "?").join(", ")}, datetime('now'))
     ON CONFLICT(handle) DO UPDATE SET ${keys
       .map((k) => `${k} = excluded.${k}`)
       .join(", ")}, updated_at = datetime('now')`
  ).run(handle, ...keys.map((k) => fields[k]));
}

// Only http(s) links — reject javascript:/data: etc. (the url is rendered into
// an href, so a bad scheme would be stored XSS).
function safeHttpUrl(raw: string): string | null {
  let url = raw.trim().slice(0, 300);
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function setProfileBio(handle: string, bio: string | null): void {
  upsertExtras(handle, { bio: bio?.trim().slice(0, 500) || null });
}

export function setProfileLinks(handle: string, links: ProfileLink[]): void {
  const clean = (links || [])
    .filter((l) => l && typeof l.url === "string")
    .map((l) => ({ label: String(l.label || "").trim().slice(0, 40), url: safeHttpUrl(l.url) }))
    .filter((l): l is ProfileLink => l.url !== null)
    .slice(0, 10);
  upsertExtras(handle, { links_json: JSON.stringify(clean) });
}

export function setProfileCustomFields(
  handle: string,
  fields: ProfileField[]
): void {
  const clean = (fields || [])
    .filter((f) => f && typeof f.label === "string" && typeof f.value === "string")
    .map((f) => ({
      label: String(f.label).trim().slice(0, 40),
      value: String(f.value).trim().slice(0, 200),
      public: Boolean(f.public),
    }))
    .filter((f) => f.label && f.value)
    .slice(0, 12);
  upsertExtras(handle, { fields_json: JSON.stringify(clean) });
}

// Convenience: set bio + links together (e.g. from the profile editor, which
// always submits both). The route uses the granular setters so a partial API
// update touches only the fields actually present.
export function setProfileBioLinks(
  handle: string,
  bio: string | null,
  links: ProfileLink[]
): void {
  setProfileBio(handle, bio);
  setProfileLinks(handle, links);
}

export function setProfileBanner(handle: string, bannerKey: string): void {
  upsertExtras(handle, { banner_key: bannerKey });
}

// Free-text location (e.g. "Stockholm, Sweden"). Empty clears it.
export function setProfileLocation(handle: string, location: string | null): void {
  upsertExtras(handle, { location: location?.trim().slice(0, 80) || null });
}

// Set (or clear) the Instagram source + auto-poll flag for a profile. The
// instagram_handle is the IG username to pull from; pass null to disconnect.
export function setProfileInstagram(
  handle: string,
  instagramHandle: string | null,
  autoPoll: boolean
): void {
  upsertExtras(handle, {
    instagram_handle: instagramHandle,
    ig_auto_poll: autoPoll ? "1" : "0",
  });
}

// Per-user preference: surface 18+ content outside the dedicated 18+ section.
// Viewing still requires the PIN cookie; this only controls whether adult
// content is woven into general browsing.
export function getShowAdultOutside(userId: number): boolean {
  const row = getOne<{ show_adult_outside: number }>(
    qb
      .selectFrom("user_profiles")
      .select("show_adult_outside")
      .where("user_id", "=", userId)
  );
  return Boolean(row?.show_adult_outside);
}

export function setShowAdultOutside(userId: number, on: boolean): void {
  db.prepare(
    "UPDATE user_profiles SET show_adult_outside = ? WHERE user_id = ?"
  ).run(on ? 1 : 0, userId);
}
