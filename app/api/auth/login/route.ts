import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getUserByEmail } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";
import {
  loginLockRemainingSec,
  recordLoginFailure,
  clearLoginFailures,
} from "@/lib/login-rate-limit";
import {
  createSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/session";
import { createSession } from "@/lib/sessions";
import { randomUUID } from "crypto";

export async function POST(request: Request) {
  const { email, password } = await request.json().catch(() => ({}));

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required." },
      { status: 400 }
    );
  }

  // Reject early if this account is currently locked out from repeated failures.
  const lockedSec = loginLockRemainingSec(email);
  if (lockedSec > 0) {
    return NextResponse.json(
      {
        error: `Too many failed attempts. Try again in ${Math.ceil(
          lockedSec / 60
        )} min.`,
      },
      { status: 429, headers: { "Retry-After": String(lockedSec) } }
    );
  }

  const user = getUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    recordLoginFailure(email);
    return NextResponse.json(
      { error: "Invalid email or password." },
      { status: 401 }
    );
  }

  clearLoginFailures(email);

  const jti = randomUUID();
  const token = await createSessionToken({
    sub: String(user.id),
    email: user.email,
    role: user.role,
    jti,
  });
  createSession(
    jti,
    user.id,
    request.headers.get("user-agent"),
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null
  );

  cookies().set(SESSION_COOKIE, token, sessionCookieOptions);
  return NextResponse.json({ ok: true, role: user.role });
}
