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

/**
 * `Set-Cookie` headers that clear the session cookie in every scope it can
 * exist in.
 *
 * Deletion matches on domain as well as name and path, and widening the domain
 * did not replace anybody's existing cookie — it minted a second one beside it.
 * So a browser that was logged in before this change carries both, sends both,
 * and puts the older host-only one first, because a browser orders equal-path
 * cookies oldest first. Clearing only one leaves the other signed, sent, and
 * read ahead of any fresh login.
 *
 * Written as headers rather than two `cookies().delete()` calls: the response
 * cookie store is keyed by name, so the second call replaces the first and
 * exactly one of the two scopes survives — silently, and in the wrong
 * direction.
 */
export function sessionClearCookieHeaders(): string[] {
  const flags = [
    "Path=/",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax",
    ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
  ].join("; ");
  const hostOnly = `${SESSION_COOKIE}=; ${flags}`;
  return COOKIE_DOMAIN
    ? [`${SESSION_COOKIE}=; Domain=${COOKIE_DOMAIN}; ${flags}`, hostOnly]
    : [hostOnly];
}
