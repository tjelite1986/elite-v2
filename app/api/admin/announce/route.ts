import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { announce } from "@/lib/notifications";

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
