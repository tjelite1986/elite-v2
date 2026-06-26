import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { revokeSession, revokeOtherSessions } from "@/lib/sessions";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = Number(session.sub);
  const { jti, others } = await request.json().catch(() => ({}));

  if (others) {
    // Sign out every other device, keeping the current one. Requires a jti to
    // identify "this" device — without it we can't safely keep the current
    // session, so refuse rather than wipe everything (legacy/impersonation token).
    if (!session.jti) {
      return NextResponse.json(
        { error: "Cannot identify the current device." },
        { status: 400 }
      );
    }
    revokeOtherSessions(session.jti, userId);
  } else if (typeof jti === "string" && jti) {
    revokeSession(jti, userId);
  } else {
    return NextResponse.json({ error: "Nothing to revoke." }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
