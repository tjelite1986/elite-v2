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
    // Sign out every other device, keeping the current one.
    revokeOtherSessions(session.jti ?? "", userId);
  } else if (typeof jti === "string" && jti) {
    revokeSession(jti, userId);
  } else {
    return NextResponse.json({ error: "Nothing to revoke." }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
