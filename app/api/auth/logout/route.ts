import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { revokeSession } from "@/lib/sessions";

export async function POST() {
  // Drop this device's session row so the token can't be reused after logout.
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (token) {
    const session = await verifySessionToken(token);
    if (session?.jti) revokeSession(session.jti, Number(session.sub));
  }
  cookies().delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
