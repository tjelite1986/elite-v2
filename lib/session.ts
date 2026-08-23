import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "elite_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface SessionPayload {
  sub: string; // user id as string
  email: string;
  role: "user" | "admin";
  // Set only while an admin is acting AS another account (impersonation): the
  // real admin behind the session, used to render the "acting as" banner and to
  // return to admin. Lives inside the signed JWT, so it can't be forged.
  imp?: { sub: string; email: string };
  // JWT id — the device/session row this token belongs to. Present on tokens
  // minted at login/register; absent on impersonation and legacy tokens.
  jti?: string;
}

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set");
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  const jwt = new SignJWT({
    email: payload.email,
    role: payload.role,
    ...(payload.imp ? { imp: payload.imp } : {}),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime("7d");
  if (payload.jti) jwt.setJti(payload.jti);
  return jwt.sign(getSecret());
}

export async function verifySessionToken(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const result: SessionPayload = {
      sub: String(payload.sub),
      email: String(payload.email),
      role: (payload.role as "user" | "admin") ?? "user",
    };
    if (typeof payload.jti === "string") result.jti = payload.jti;
    // Accept `imp` only when well-formed, so a malformed claim can't break the
    // banner / return-to-admin logic.
    const imp = payload.imp as unknown;
    if (
      imp &&
      typeof (imp as { sub?: unknown }).sub === "string" &&
      typeof (imp as { email?: unknown }).email === "string"
    ) {
      result.imp = {
        sub: (imp as { sub: string }).sub,
        email: (imp as { email: string }).email,
      };
    }
    return result;
  } catch {
    return null;
  }
}

// Which hosts the session cookie is sent to. Unset (the default, and what the
// test sandbox runs with) means host-only: only the origin that set it. Set to
// ".mecloud.win" in production so sibling apps on the same parent domain — the
// App Store at astore.mecloud.win — see the same login instead of asking for a
// second one. Widening this hands the cookie to every host under the domain,
// so it belongs in the environment rather than hard-coded here.
const COOKIE_DOMAIN = process.env.SESSION_COOKIE_DOMAIN || undefined;

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: MAX_AGE_SECONDS,
  ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
};

// Deleting a cookie only matches on name, path and domain, so a plain
// delete(SESSION_COOKIE) leaves a domain-scoped cookie in place — logout would
// return ok and the browser would keep sending the old token to every sibling
// host. Every clear site uses this instead.
export const sessionCookieClearOptions = {
  name: SESSION_COOKIE,
  path: "/",
  ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
};
