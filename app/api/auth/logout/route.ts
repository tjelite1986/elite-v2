import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  sessionCookieClearOptions,
  verifySessionToken,
} from "@/lib/session";
import { revokeSession } from "@/lib/sessions";

export async function POST() {
  // Drop this device's session row so the token can't be reused after logout.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) {
    const session = await verifySessionToken(token);
    if (session?.jti) revokeSession(session.jti, Number(session.sub));
  }
  (await cookies()).delete(sessionCookieClearOptions);
  return NextResponse.json({ ok: true });
}
