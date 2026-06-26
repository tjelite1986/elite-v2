import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listSessions } from "@/lib/sessions";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = listSessions(Number(session.sub)).map((r) => ({
    jti: r.jti,
    user_agent: r.user_agent,
    ip: r.ip,
    created_at: r.created_at,
    last_seen_at: r.last_seen_at,
    current: r.jti === session.jti,
  }));
  return NextResponse.json({ sessions: rows });
}
