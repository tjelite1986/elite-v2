// Maps Elite accounts onto Navidrome accounts, one per music library.
//
// Elite users have no Navidrome login of their own, and a single shared service
// account would pool everyone's playlists, favourites and play counts into one
// pile. So each Elite user gets their own Navidrome user, created on demand:
//
//   1. log in to the native API as the Navidrome admin        -> bearer token
//   2. POST /api/user   (elite_<username>, random password)   -> user id
//   3. log in as that new user                                -> subsonicSalt +
//                                                                subsonicToken
//   4. store the salt/token pair, throw the password away
//
// Step 4 is the point of the dance. Subsonic token auth is `u`+`s`+`t`, so the
// pair alone authenticates every later call — Elite never needs the password
// again and therefore never has to store a reversibly-encrypted secret. If the
// pair is ever lost, the admin API can reset the password and mint a new one.
//
// The native API (/auth/login, /api/user) is Navidrome's own web-UI API, not the
// documented Subsonic contract. Everything here fails soft: a shape change
// surfaces as a MusicAccountError, and the UI falls back to asking the user to
// link an existing Navidrome account by hand.

import { randomBytes } from "crypto";
import { db } from "./db";
import { ensureUserProfile } from "./profiles";
import { getUserById } from "./auth";
import {
  MusicLibrary,
  SubsonicCreds,
  libraryBaseUrl,
} from "./subsonic";

export class MusicAccountError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "not_configured"
      | "no_admin"
      | "admin_login_failed"
      | "provision_failed"
      | "login_failed"
  ) {
    super(message);
    this.name = "MusicAccountError";
  }
}

interface MusicAccountRow {
  user_id: number;
  library: string;
  nd_user_id: string | null;
  nd_username: string;
  subsonic_salt: string;
  subsonic_token: string;
  created_at: string;
}

interface NdLogin {
  id?: string;
  username?: string;
  name?: string;
  isAdmin?: boolean;
  token?: string;
  subsonicSalt?: string;
  subsonicToken?: string;
}

// ---------------------------------------------------------------------------
// Native API
// ---------------------------------------------------------------------------

async function ndLogin(
  baseUrl: string,
  username: string,
  password: string
): Promise<NdLogin> {
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new MusicAccountError(
      `Navidrome login failed for ${username} (HTTP ${res.status})`,
      "login_failed"
    );
  }
  return (await res.json()) as NdLogin;
}

// Admin bearer tokens are reused across requests — a login costs a bcrypt
// verification on the Navidrome side, and provisioning is otherwise a
// once-per-user event. Refreshed well inside Navidrome's session lifetime.
const adminTokens = new Map<string, { token: string; expires: number }>();
const ADMIN_TOKEN_TTL_MS = 15 * 60 * 1000;

async function ndAdminToken(baseUrl: string): Promise<string> {
  const cached = adminTokens.get(baseUrl);
  if (cached && cached.expires > Date.now()) return cached.token;

  const user = process.env.NAVIDROME_ADMIN_USER;
  const password = process.env.NAVIDROME_ADMIN_PASSWORD;
  if (!user || !password) {
    throw new MusicAccountError(
      "NAVIDROME_ADMIN_USER / NAVIDROME_ADMIN_PASSWORD are not set",
      "no_admin"
    );
  }
  let login: NdLogin;
  try {
    login = await ndLogin(baseUrl, user, password);
  } catch {
    throw new MusicAccountError(
      "Could not log in to Navidrome as the admin",
      "admin_login_failed"
    );
  }
  if (!login.token) {
    throw new MusicAccountError(
      "Navidrome admin login returned no token",
      "admin_login_failed"
    );
  }
  adminTokens.set(baseUrl, {
    token: login.token,
    expires: Date.now() + ADMIN_TOKEN_TTL_MS,
  });
  return login.token;
}

async function ndAdminFetch(
  baseUrl: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const token = await ndAdminToken(baseUrl);
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      "content-type": "application/json",
      "x-nd-authorization": `Bearer ${token}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  // A rejected cached token is the one failure worth one retry: drop it and
  // log in again rather than failing a user's first visit to /music.
  if (res.status === 401) {
    adminTokens.delete(baseUrl);
    const fresh = await ndAdminToken(baseUrl);
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.headers || {}),
        "content-type": "application/json",
        "x-nd-authorization": `Bearer ${fresh}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
  }
  return res;
}

async function ndFindUser(
  baseUrl: string,
  userName: string
): Promise<{ id: string } | null> {
  const res = await ndAdminFetch(
    baseUrl,
    `/api/user?_start=0&_end=500&_sort=userName&_order=ASC`
  );
  if (!res.ok) return null;
  const list = (await res.json().catch(() => null)) as
    | { id?: string; userName?: string }[]
    | null;
  if (!Array.isArray(list)) return null;
  const hit = list.find(
    (u) => (u.userName || "").toLowerCase() === userName.toLowerCase()
  );
  return hit?.id ? { id: hit.id } : null;
}

async function ndCreateUser(
  baseUrl: string,
  userName: string,
  displayName: string,
  password: string
): Promise<string | null> {
  const res = await ndAdminFetch(baseUrl, "/api/user", {
    method: "POST",
    body: JSON.stringify({
      userName,
      name: displayName,
      email: "",
      password,
      isAdmin: false,
    }),
  });
  if (!res.ok) {
    throw new MusicAccountError(
      `Could not create the Navidrome user ${userName} (HTTP ${res.status})`,
      "provision_failed"
    );
  }
  const created = (await res.json().catch(() => null)) as { id?: string } | null;
  return created?.id ?? null;
}

async function ndSetPassword(
  baseUrl: string,
  userId: string,
  userName: string,
  displayName: string,
  password: string
): Promise<void> {
  const res = await ndAdminFetch(baseUrl, `/api/user/${userId}`, {
    method: "PUT",
    body: JSON.stringify({
      id: userId,
      userName,
      name: displayName,
      password,
      isAdmin: false,
    }),
  });
  if (!res.ok) {
    throw new MusicAccountError(
      `Could not reset the Navidrome password for ${userName} (HTTP ${res.status})`,
      "provision_failed"
    );
  }
}

// ---------------------------------------------------------------------------
// Stored accounts
// ---------------------------------------------------------------------------

function getRow(userId: number, library: MusicLibrary): MusicAccountRow | undefined {
  return db
    .prepare("SELECT * FROM music_accounts WHERE user_id = ? AND library = ?")
    .get(userId, library) as MusicAccountRow | undefined;
}

function saveRow(
  userId: number,
  library: MusicLibrary,
  ndUserId: string | null,
  ndUsername: string,
  salt: string,
  token: string
): void {
  db.prepare(
    `INSERT INTO music_accounts
       (user_id, library, nd_user_id, nd_username, subsonic_salt, subsonic_token)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, library) DO UPDATE SET
       nd_user_id = excluded.nd_user_id,
       nd_username = excluded.nd_username,
       subsonic_salt = excluded.subsonic_salt,
       subsonic_token = excluded.subsonic_token`
  ).run(userId, library, ndUserId, ndUsername, salt, token);
}

export function hasMusicAccount(userId: number, library: MusicLibrary): boolean {
  return Boolean(getRow(userId, library));
}

export function unlinkMusicAccount(userId: number, library: MusicLibrary): void {
  db.prepare("DELETE FROM music_accounts WHERE user_id = ? AND library = ?").run(
    userId,
    library
  );
}

// Navidrome usernames are matched case-insensitively and used in URLs; keep to
// the same character class the Elite username validator already guarantees.
function navidromeUsername(eliteUsername: string): string {
  const safe = eliteUsername.toLowerCase().replace(/[^a-z0-9._-]/g, "");
  return `elite_${safe || "user"}`;
}

function credsFrom(
  row: MusicAccountRow,
  library: MusicLibrary,
  baseUrl: string
): SubsonicCreds {
  return {
    library,
    baseUrl,
    username: row.nd_username,
    salt: row.subsonic_salt,
    token: row.subsonic_token,
  };
}

// Two parallel first-time requests (the page and its data fetch) would otherwise
// both try to create the same Navidrome user; the second would fail on the
// unique username. Share one in-flight provisioning promise per user+library.
const inFlight = new Map<string, Promise<SubsonicCreds>>();

/**
 * Credentials for this Elite user against one library, provisioning the
 * Navidrome account on first use. Throws MusicAccountError when that is not
 * possible — callers surface `reason` so the UI can offer manual linking.
 */
export async function getMusicCreds(
  userId: number,
  library: MusicLibrary
): Promise<SubsonicCreds> {
  const baseUrl = libraryBaseUrl(library);
  if (!baseUrl) {
    throw new MusicAccountError(
      `Music library "${library}" is not configured`,
      "not_configured"
    );
  }

  const existing = getRow(userId, library);
  if (existing) return credsFrom(existing, library, baseUrl);

  const key = `${userId}:${library}`;
  const running = inFlight.get(key);
  if (running) return running;

  const task = provision(userId, library, baseUrl).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, task);
  return task;
}

async function provision(
  userId: number,
  library: MusicLibrary,
  baseUrl: string
): Promise<SubsonicCreds> {
  const user = getUserById(userId);
  if (!user) {
    throw new MusicAccountError("Unknown Elite user", "provision_failed");
  }
  const profile = ensureUserProfile(userId, user.email);
  const userName = navidromeUsername(profile.username);
  const displayName = profile.display_name || profile.username;
  const password = randomBytes(24).toString("base64url");

  // An account may already exist from an earlier provisioning whose stored
  // token was lost (DB reset, manual deletion of the row). Reset its password
  // rather than failing on the unique username.
  const found = await ndFindUser(baseUrl, userName);
  let ndUserId: string | null;
  if (found) {
    await ndSetPassword(baseUrl, found.id, userName, displayName, password);
    ndUserId = found.id;
  } else {
    ndUserId = await ndCreateUser(baseUrl, userName, displayName, password);
  }

  const login = await ndLogin(baseUrl, userName, password);
  if (!login.subsonicSalt || !login.subsonicToken) {
    throw new MusicAccountError(
      "Navidrome login returned no Subsonic credentials",
      "provision_failed"
    );
  }
  saveRow(
    userId,
    library,
    ndUserId ?? login.id ?? null,
    userName,
    login.subsonicSalt,
    login.subsonicToken
  );
  return {
    library,
    baseUrl,
    username: userName,
    salt: login.subsonicSalt,
    token: login.subsonicToken,
  };
}

/**
 * Manual fallback: link an existing Navidrome account by username + password.
 * The password is used once, to mint the salt/token pair, and not stored.
 */
export async function linkMusicAccount(
  userId: number,
  library: MusicLibrary,
  username: string,
  password: string
): Promise<void> {
  const baseUrl = libraryBaseUrl(library);
  if (!baseUrl) {
    throw new MusicAccountError(
      `Music library "${library}" is not configured`,
      "not_configured"
    );
  }
  const login = await ndLogin(baseUrl, username, password);
  if (!login.subsonicSalt || !login.subsonicToken) {
    throw new MusicAccountError(
      "Navidrome login returned no Subsonic credentials",
      "login_failed"
    );
  }
  saveRow(
    userId,
    library,
    login.id ?? null,
    login.username || username,
    login.subsonicSalt,
    login.subsonicToken
  );
}
