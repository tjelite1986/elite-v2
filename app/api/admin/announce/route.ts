import { NextResponse } from "next/server";
import { sql } from "kysely";
import { getSession } from "@/lib/auth";
import { qb, getAll } from "@/lib/kysely";
import { announce } from "@/lib/notifications";

// Recent announcements (one row per broadcast — the per-user copies are
// grouped by message + minute). Admin only.
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = getAll<{
    message: string;
    href: string | null;
    created_at: string;
    recipients: number;
  }>(
    qb
      .selectFrom("notifications")
      .select((eb) => [
        "message",
        "href",
        eb.fn.min("created_at").as("created_at"),
        eb.fn.countAll<number>().as("recipients"),
      ])
      .where("type", "=", "system")
      .groupBy(["message", "href", sql`substr(created_at, 1, 16)`])
      .orderBy("created_at", "desc")
      .limit(10)
  );

  return NextResponse.json({ announcements: rows });
}

// Broadcast a system announcement to every user's notifications
// (e.g. release notes for a new feature). Admin only.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const href = typeof body?.href === "string" ? body.href.trim() : null;
  if (!message || message.length > 500) {
    return NextResponse.json(
      { error: "A message (max 500 characters) is required." },
      { status: 400 }
    );
  }
  // In-app paths only — "//host" and "/\host" are protocol-relative external
  // redirects and must not slip through the leading-slash check.
  if (href && (!href.startsWith("/") || /^\/[\\/]/.test(href))) {
    return NextResponse.json(
      { error: "href must be an in-app path starting with /." },
      { status: 400 }
    );
  }

  const recipients = announce(Number(session.sub), message, href);
  return NextResponse.json({ ok: true, recipients });
}
