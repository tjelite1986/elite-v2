import { cookies } from "next/headers";
import { UserRow } from "./db";
import { qb, getOne } from "./kysely";
import { SESSION_COOKIE, verifySessionToken, SessionPayload } from "./session";

// Server-side helper: read the current session from the request cookies.
// Runs in the Node runtime (route handlers / server components), not edge.
export async function getSession(): Promise<SessionPayload | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
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
