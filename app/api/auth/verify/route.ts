import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { sessionExists, touchSession } from "@/lib/sessions";

export const dynamic = "force-dynamic";

/**
 * Resolve a session token to the account behind it, for a sibling app.
 *
 * The App Store (astore.mecloud.win) shares this login: the session cookie is
 * scoped to the parent domain, so the browser sends it there too. What the
 * store cannot do is finish the check on its own. Signature verification alone
 * would accept a token whose session row has been revoked — that row lives in
 * this app's database, and a revoked-but-still-signed token stays valid for up
 * to seven days. So the store asks here instead, and the signing secret never
 * has to leave this app.
 *
 * The token is the credential: this answers only what its holder already
 * knows, and nothing at all without one. A caller with no valid token gets 401
 * and no detail about why.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const token =
    typeof body?.token === "string" && body.token
      ? body.token
      : (await cookies()).get(SESSION_COOKIE)?.value;

  if (!token) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Same revocation rule as getSession: a token whose device row is gone is
  // dead. Tokens without a jti (impersonation, legacy) skip the check there,
  // and skip it here for the same reason.
  if (session.jti) {
    if (!sessionExists(session.jti)) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
    touchSession(session.jti);
  }

  // While an admin is acting as another account, `role` is already that
  // account's — the store sees what the impersonated user would see, which is
  // the point of impersonation.
  return NextResponse.json({
    ok: true,
    user: { id: Number(session.sub), email: session.email, role: session.role },
  });
}
