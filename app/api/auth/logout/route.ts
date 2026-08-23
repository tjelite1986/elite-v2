import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  sessionClearCookieHeaders,
  verifySessionToken,
} from "@/lib/session";
import { revokeSession } from "@/lib/sessions";

export async function POST() {
  // Every token under this name, not just the first: a browser from before the
  // cookie was widened to the parent domain carries a second, host-only one,
  // and revoking only the one that happened to be read would leave a live
  // session behind that comes back the moment the other expires.
  for (const cookie of (await cookies()).getAll(SESSION_COOKIE)) {
    const session = await verifySessionToken(cookie.value);
    if (session?.jti) revokeSession(session.jti, Number(session.sub));
  }

  const res = NextResponse.json({ ok: true });
  for (const header of sessionClearCookieHeaders()) {
    res.headers.append("set-cookie", header);
  }
  return res;
}
