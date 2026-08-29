import { NextResponse } from "next/server";
import { getSession, getUserById } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";
import { db } from "@/lib/db";
import { createGateToken, GATE_COOKIE, gateCookieOptions } from "@/lib/shorts-gate";

export const dynamic = "force-dynamic";

// Manage the current user's OPTIONAL personal 18+ PIN. With no PIN, adult
// content is open; setting one locks 18+ surfaces on this account behind it.
//   PUT    { pin, current? }  set or change (current required when changing)
//   DELETE { current }        remove (current required)

// Same in-memory throttle as the unlock route: a short PIN must not be
// brute-forceable via the change/remove endpoints either.
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 10 * 60 * 1000;
const failures = new Map<string, { count: number; resetAt: number }>();

function isLockedOut(userId: string): boolean {
  const rec = failures.get(userId);
  return !!rec && Date.now() <= rec.resetAt && rec.count >= MAX_ATTEMPTS;
}
function recordFailure(userId: string) {
  const now = Date.now();
  const rec = failures.get(userId);
  if (!rec || now > rec.resetAt) {
    failures.set(userId, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    rec.count++;
  }
}
const lockedOutResponse = () =>
  NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });

export async function PUT(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Act-as sessions must not change the target account's 18+ PIN: the admin
  // doesn't know the content-owner's current PIN, and shouldn't be able to
  // set one for them either.
  if (session.imp) {
    return NextResponse.json(
      { error: "Cannot change the 18+ PIN while acting as another account." },
      { status: 403 }
    );
  }
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
    if (isLockedOut(session.sub)) return lockedOutResponse();
    if (!verifyPassword(current, user.adult_pin_hash)) {
      recordFailure(session.sub);
      return NextResponse.json({ error: "Current PIN is incorrect." }, { status: 401 });
    }
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
  if (session.imp) {
    return NextResponse.json(
      { error: "Cannot change the 18+ PIN while acting as another account." },
      { status: 403 }
    );
  }
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
  if (isLockedOut(session.sub)) return lockedOutResponse();
  if (!verifyPassword(current, user.adult_pin_hash)) {
    recordFailure(session.sub);
    return NextResponse.json({ error: "Current PIN is incorrect." }, { status: 401 });
  }

  db.prepare("UPDATE users SET adult_pin_hash = NULL WHERE id = ?").run(user.id);
  const res = NextResponse.json({ ok: true, hasPin: false });
  res.cookies.set(GATE_COOKIE, "", { ...gateCookieOptions, maxAge: 0 });
  return res;
}
