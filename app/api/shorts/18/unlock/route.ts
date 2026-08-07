import { NextResponse } from "next/server";
import { getSession, getUserById } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";
import {
  GATE_COOKIE,
  createGateToken,
  gateCookieOptions,
} from "@/lib/shorts-gate";
import { makeThrottle } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// In-memory throttle so a short numeric PIN can't be brute-forced: max 5 failed
// attempts per 10 minutes per user, then 429. Resets on process restart, which
// is fine for a single-box personal hub. Shared with app/api/account/adult-pin.
const { isLockedOut, recordFailure, clear: clearFailures } = makeThrottle(
  5,
  10 * 60 * 1000
);

// Verify the 18+ PIN and, on success, set the signed gate cookie. Generic error
// messages avoid revealing whether a PIN is configured.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (isLockedOut(session.sub)) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429 }
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
    recordFailure(session.sub);
    return NextResponse.json({ error: "Incorrect PIN" }, { status: 401 });
  }

  clearFailures(session.sub); // clear throttle on success
  const token = await createGateToken(session.sub);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(GATE_COOKIE, token, gateCookieOptions);
  return res;
}
