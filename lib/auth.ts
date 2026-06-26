import { cookies } from "next/headers";
import { UserRow } from "./db";
import { qb, getOne } from "./kysely";
import { SESSION_COOKIE, verifySessionToken, SessionPayload } from "./session";
import { sessionExists, touchSession } from "./sessions";

// Server-side helper: read the current session from the request cookies.
// Runs in the Node runtime (route handlers / server components), not edge.
export async function getSession(): Promise<SessionPayload | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await verifySessionToken(token);
  if (!session) return null;
  // Enforce revocation: a token whose device/session row was deleted is dead.
  // Tokens without a jti (impersonation / legacy) skip this check.
  if (session.jti) {
    if (!sessionExists(session.jti)) return null;
    touchSession(session.jti);
  }
  return session;
}

export function getUserById(id: number): UserRow | undefined {
  return getOne<UserRow>(
    qb.selectFrom("users").selectAll().where("id", "=", id)
  );
}

export function getUserByEmail(email: string): UserRow | undefined {
  return getOne<UserRow>(
    qb.selectFrom("users").selectAll().where("email", "=", email.toLowerCase())
  );
}
