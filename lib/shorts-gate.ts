import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

// Server-side gate for the 18+ shorts channel. Unlocking requires the PIN in
// SHORTS_18_PIN; success mints a short-lived, httpOnly, signed cookie. Every
// 18+ surface (page, feed API, media route) must re-check this independently —
// no route trusts another to have gated.
export const GATE_COOKIE = "elite_18";
const GATE_MAX_AGE_SECONDS = 60 * 60 * 2; // 2 hours

function getSecret(): Uint8Array {
  // Reuse the app's JWT secret so there's nothing extra to configure.
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export function getPin(): string | null {
  const pin = process.env.SHORTS_18_PIN;
  return pin && pin.length > 0 ? pin : null;
}

export async function createGateToken(userId: string): Promise<string> {
  return new SignJWT({ scope: "shorts18" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${GATE_MAX_AGE_SECONDS}s`)
    .sign(getSecret());
}

// Returns true if the token is a valid, unexpired 18+ gate token. Works in both
// the edge (middleware) and node runtimes since it only uses jose.
export async function verifyGateToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload.scope === "shorts18";
  } catch {
    return false;
  }
}

// Node-runtime helper for route handlers / server components.
export async function has18Access(): Promise<boolean> {
  return verifyGateToken(cookies().get(GATE_COOKIE)?.value);
}

export const gateCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: GATE_MAX_AGE_SECONDS,
};
