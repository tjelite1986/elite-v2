import { NextResponse } from "next/server";
import { sql } from "kysely";
import { InviteRequestRow } from "@/lib/db";
import { qb, getAll } from "@/lib/kysely";
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

  const requests = getAll<InviteRequestRow>(
    qb
      .selectFrom("invite_requests")
      .selectAll()
      .orderBy(sql`(status = 'pending') desc`)
      .orderBy("created_at", "desc")
  );

  return NextResponse.json({ requests, mailConfigured: isMailConfigured() });
}
