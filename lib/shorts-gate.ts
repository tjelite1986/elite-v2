import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

// 18+ gate. Adult content is OPEN to all logged-in users by default; a user may
// set a PERSONAL PIN (see lib/password hash on users.adult_pin_hash) to lock 18+
// surfaces behind it on their own account. Unlocking the PIN mints a short-lived,
// signed httpOnly cookie. Every 18+ surface re-checks has18Access independently —
// no route trusts another to have gated. (This module is also imported by the
// edge middleware, so it must NOT statically import the DB — has18Access uses a
// dynamic import for that.)
export const GATE_COOKIE = "elite_18";
const GATE_MAX_AGE_SECONDS = 60 * 60 * 2; // 2 hours

function getSecret(): Uint8Array {
  // Reuse the app's JWT secret so there's nothing extra to configure.
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export async function createGateToken(userId: string): Promise<string> {
  return new SignJWT({ scope: "shorts18" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${GATE_MAX_AGE_SECONDS}s`)
    .sign(getSecret());
}

// Valid, unexpired 18+ gate token? Optionally require it to belong to a specific
// user (subject). Edge-safe (jose only) so the middleware can call it.
export async function verifyGateToken(
  token: string | undefined,
  expectedSub?: string
): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.scope !== "shorts18") return false;
    if (expectedSub && payload.sub !== expectedSub) return false;
    return true;
  } catch {
    return false;
  }
}

// Node-runtime helper for route handlers / server components. Open unless the
// current user has set a personal PIN, in which case a valid unlock cookie for
// THAT user is required. (Dynamic import keeps better-sqlite3 out of the edge
// middleware bundle that also imports this module.)
export async function has18Access(): Promise<boolean> {
  const { getSession, getUserById } = await import("./auth");
  const session = await getSession();
  if (!session) return false;
  const user = getUserById(Number(session.sub));
  if (!user?.adult_pin_hash) return true; // no personal PIN → adult content open
  return verifyGateToken(cookies().get(GATE_COOKIE)?.value, session.sub);
}

// Whether the current user has a personal 18+ PIN set (for settings UI / prompts).
export async function hasAdultPin(): Promise<boolean> {
  const { getSession, getUserById } = await import("./auth");
  const session = await getSession();
  if (!session) return false;
  return !!getUserById(Number(session.sub))?.adult_pin_hash;
}

export const gateCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: GATE_MAX_AGE_SECONDS,
};
