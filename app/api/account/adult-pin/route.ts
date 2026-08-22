import { NextResponse } from "next/server";
import { getSession, getUserById } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";
import { db } from "@/lib/db";
import { createGateToken, GATE_COOKIE, gateCookieOptions } from "@/lib/shorts-gate";
import {
  loginLockRemainingSec,
  recordLoginFailure,
  clearLoginFailures,
} from "@/lib/login-rate-limit";

export const dynamic = "force-dynamic";

// Manage the current user's OPTIONAL personal 18+ PIN. With no PIN, adult
// content is open; setting one locks 18+ surfaces on this account behind it.
//   PUT    { pin, current? }  set or change (current required when changing)
//   DELETE { current }        remove (current required)

// Same DB-backed throttle as login and the unlock route (survives a restart):
// a short PIN must not be brute-forceable via the change/remove endpoints
// either. "pin:" keeps this namespace separate from login's email-keyed
// identifiers.
function pinThrottleId(userId: string): string {
  return `pin:${userId}`;
}
const lockedOutResponse = (lockedSec: number) =>
  NextResponse.json(
    { error: "Too many attempts. Try again later." },
    { status: 429, headers: { "Retry-After": String(lockedSec) } }
  );

export async function PUT(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = getUserById(Number(session.sub));
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let pin = "";
  let current = "";
  try {
    const body = await request.json();
    pin = typeof body?.pin === "string" ? body.pin.trim() : "";
    current = typeof body?.current === "string" ? body.current : "";
  } catch {
    /* ignore */
  }

  if (!/^[\w!@#$%^&*.-]{4,64}$/.test(pin)) {
    return NextResponse.json(
      { error: "PIN must be 4–64 characters." },
      { status: 400 }
    );
  }
  // Changing an existing PIN requires the current one.
  if (user.adult_pin_hash) {
    const throttleId = pinThrottleId(session.sub);
    const lockedSec = loginLockRemainingSec(throttleId);
    if (lockedSec > 0) return lockedOutResponse(lockedSec);
    if (!verifyPassword(current, user.adult_pin_hash)) {
      recordLoginFailure(throttleId);
      return NextResponse.json({ error: "Current PIN is incorrect." }, { status: 401 });
    }
    clearLoginFailures(throttleId);
  }

  db.prepare("UPDATE users SET adult_pin_hash = ? WHERE id = ?").run(
    hashPassword(pin),
    user.id
  );

  // Unlock this session immediately so the user isn't locked out right after
  // setting the PIN (other devices still need it).
  const res = NextResponse.json({ ok: true, hasPin: true });
  res.cookies.set(GATE_COOKIE, await createGateToken(session.sub), gateCookieOptions);
  return res;
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = getUserById(Number(session.sub));
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!user.adult_pin_hash) return NextResponse.json({ ok: true, hasPin: false });

  let current = "";
  try {
    const body = await request.json();
    current = typeof body?.current === "string" ? body.current : "";
  } catch {
    /* ignore */
  }
  const throttleId = pinThrottleId(session.sub);
  const lockedSec = loginLockRemainingSec(throttleId);
  if (lockedSec > 0) return lockedOutResponse(lockedSec);
  if (!verifyPassword(current, user.adult_pin_hash)) {
    recordLoginFailure(throttleId);
    return NextResponse.json({ error: "Current PIN is incorrect." }, { status: 401 });
  }
  clearLoginFailures(throttleId);

  db.prepare("UPDATE users SET adult_pin_hash = NULL WHERE id = ?").run(user.id);
  const res = NextResponse.json({ ok: true, hasPin: false });
  res.cookies.set(GATE_COOKIE, "", { ...gateCookieOptions, maxAge: 0 });
  return res;
}
