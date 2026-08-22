import { NextResponse } from "next/server";
import { getSession, getUserById } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";
import {
  GATE_COOKIE,
  createGateToken,
  gateCookieOptions,
} from "@/lib/shorts-gate";
import {
  loginLockRemainingSec,
  recordLoginFailure,
  clearLoginFailures,
} from "@/lib/login-rate-limit";

export const dynamic = "force-dynamic";

// Same DB-backed throttle as login (survives a restart, unlike an in-memory
// counter): max 5 failed attempts before a lockout. "pin:" keeps this
// namespace separate from login's email-keyed identifiers.
function pinThrottleId(userId: string): string {
  return `pin:${userId}`;
}

// Verify the 18+ PIN and, on success, set the signed gate cookie. Generic error
// messages avoid revealing whether a PIN is configured.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const throttleId = pinThrottleId(session.sub);
  const lockedSec = loginLockRemainingSec(throttleId);
  if (lockedSec > 0) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(lockedSec) } }
    );
  }

  const user = getUserById(Number(session.sub));
  if (!user?.adult_pin_hash) {
    // No personal PIN set → nothing to unlock (adult content is already open).
    return NextResponse.json({ error: "No PIN set" }, { status: 400 });
  }

  let submitted = "";
  try {
    const body = await request.json();
    submitted = typeof body?.pin === "string" ? body.pin : "";
  } catch {
    submitted = "";
  }

  if (!submitted || !verifyPassword(submitted, user.adult_pin_hash)) {
    recordLoginFailure(throttleId);
    return NextResponse.json({ error: "Incorrect PIN" }, { status: 401 });
  }

  clearLoginFailures(throttleId); // clear throttle on success
  const token = await createGateToken(session.sub);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(GATE_COOKIE, token, gateCookieOptions);
  return res;
}
