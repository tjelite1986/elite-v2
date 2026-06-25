import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession, getUserById, getUserByEmail } from "@/lib/auth";
import { qb, getAll } from "@/lib/kysely";
import {
  createSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
  SessionPayload,
} from "@/lib/session";

export const dynamic = "force-dynamic";

// Admin "act-as" (impersonation): a logged-in admin switches the session to act
// AS a content-owner account (public@/adults@) to maintain that bucket, then
// returns to admin (POST /api/auth/return-to-admin). The minted token carries
// the TARGET's role — so impersonating a content owner yields role 'user' and
// admin UI/routes hide — plus `imp` = the real admin, used to return.

// The REAL admin behind the current session: the session itself (a genuine admin
// not impersonating) or, while already acting-as, the `imp` identity re-verified
// to still be an admin. null when the caller may not impersonate.
function realAdmin(
  session: SessionPayload
): { sub: string; email: string } | null {
  if (session.role === "admin" && !session.imp) {
    return { sub: session.sub, email: session.email };
  }
  if (session.imp) {
    const admin = getUserById(Number(session.imp.sub));
    if (admin && admin.role === "admin") {
      return { sub: String(admin.id), email: admin.email };
    }
  }
  return null;
}

// GET: the content-owner accounts (public@/adults@ from env) that exist, for the
// switcher. Scoped on purpose — never expose the whole user table.
export async function GET() {
  const session = await getSession();
  if (!session || !realAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const emails = [process.env.PUBLIC_EMAIL, process.env.ADULTS_EMAIL]
    .filter((e): e is string => Boolean(e))
    .map((e) => e.toLowerCase());
  if (emails.length === 0) return NextResponse.json({ accounts: [] });

  const accounts = getAll<{ id: number; email: string; username: string | null }>(
    qb
      .selectFrom("users as u")
      .leftJoin("user_profiles as p", "p.user_id", "u.id")
      .select(["u.id", "u.email", "p.username"])
      .where("u.email", "in", emails)
      .orderBy("u.email")
  );
  return NextResponse.json({ accounts });
}

// POST { email? , userId? }: switch to act AS the target account.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = realAdmin(session);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const target =
    typeof body.userId === "number"
      ? getUserById(body.userId)
      : typeof body.email === "string"
        ? getUserByEmail(body.email)
        : undefined;
  if (!target) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }
  // Restrict impersonation to the env content-owner buckets (public@/adults@) —
  // the same allowlist the GET switcher exposes. Without this a real admin could
  // act as ANY user and read their private content; this matches the documented
  // design and limits blast radius.
  const allowedTargets = [process.env.PUBLIC_EMAIL, process.env.ADULTS_EMAIL]
    .filter((e): e is string => Boolean(e))
    .map((e) => e.toLowerCase());
  if (!allowedTargets.includes(target.email.toLowerCase())) {
    return NextResponse.json(
      { error: "Can only act as a content-owner account." },
      { status: 403 }
    );
  }
  if (target.role === "admin") {
    return NextResponse.json(
      { error: "Cannot act as an admin account." },
      { status: 403 }
    );
  }
  if (String(target.id) === admin.sub) {
    return NextResponse.json({ error: "Already this account." }, { status: 400 });
  }

  const token = await createSessionToken({
    sub: String(target.id),
    email: target.email,
    role: target.role,
    imp: admin,
  });
  cookies().set(SESSION_COOKIE, token, sessionCookieOptions);
  console.log(`[act-as] ${admin.email} -> ${target.email}`);
  return NextResponse.json({ ok: true, email: target.email });
}
