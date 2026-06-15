import { cookies } from "next/headers";
import { db, UserRow } from "./db";
import { SESSION_COOKIE, verifySessionToken, SessionPayload } from "./session";

// Server-side helper: read the current session from the request cookies.
// Runs in the Node runtime (route handlers / server components), not edge.
export async function getSession(): Promise<SessionPayload | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export function getUserById(id: number): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
    | UserRow
    | undefined;
}

export function getUserByEmail(email: string): UserRow | undefined {
  return db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email.toLowerCase()) as UserRow | undefined;
}
