import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { getSession, getUserById } from "@/lib/auth";
import {
  createSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/session";
import { createSession } from "@/lib/sessions";

export const dynamic = "force-dynamic";

// End an impersonation: mint a clean admin session for the real admin recorded
// in the session's `imp`, re-verifying that account is still an admin.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.imp) {
    return NextResponse.json({ error: "Not impersonating." }, { status: 400 });
  }
  const admin = getUserById(Number(session.imp.sub));
  if (!admin || admin.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Unlike the act-as token (intentionally jti-less), the returned admin
  // session must be a real revocable session: registered in the sessions
  // table so it shows up in device management and can be revoked.
  const jti = randomUUID();
  const token = await createSessionToken({
    sub: String(admin.id),
    email: admin.email,
    role: admin.role,
    jti,
  });
  createSession(
    jti,
    admin.id,
    request.headers.get("user-agent"),
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null
  );
  cookies().set(SESSION_COOKIE, token, sessionCookieOptions);
  console.log(`[act-as] return to admin ${admin.email}`);
  return NextResponse.json({ ok: true });
}
