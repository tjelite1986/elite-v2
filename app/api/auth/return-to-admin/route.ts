import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession, getUserById } from "@/lib/auth";
import {
  createSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/session";

export const dynamic = "force-dynamic";

// End an impersonation: mint a clean admin session for the real admin recorded
// in the session's `imp`, re-verifying that account is still an admin.
export async function POST() {
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

  const token = await createSessionToken({
    sub: String(admin.id),
    email: admin.email,
    role: admin.role,
  });
  cookies().set(SESSION_COOKIE, token, sessionCookieOptions);
  console.log(`[act-as] return to admin ${admin.email}`);
  return NextResponse.json({ ok: true });
}
