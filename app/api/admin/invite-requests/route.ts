import { NextResponse } from "next/server";
import { db, InviteRequestRow } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { isMailConfigured } from "@/lib/mail";

async function requireAdmin() {
  const session = await getSession();
  if (!session || session.role !== "admin") return null;
  return session;
}

// List invite requests (pending first, newest first).
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const requests = db
    .prepare(
      `SELECT * FROM invite_requests
       ORDER BY (status = 'pending') DESC, created_at DESC`
    )
    .all() as InviteRequestRow[];

  return NextResponse.json({ requests, mailConfigured: isMailConfigured() });
}
