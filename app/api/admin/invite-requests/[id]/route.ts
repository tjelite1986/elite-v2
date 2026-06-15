import { NextResponse } from "next/server";
import { db, InviteRequestRow } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getUserByEmail } from "@/lib/auth";
import { generateUniqueCode, expiresAtFromDays } from "@/lib/codes";
import { sendInviteEmail } from "@/lib/mail";

async function requireAdmin() {
  const session = await getSession();
  if (!session || session.role !== "admin") return null;
  return session;
}

function getRequest(id: number): InviteRequestRow | undefined {
  return db
    .prepare("SELECT * FROM invite_requests WHERE id = ?")
    .get(id) as InviteRequestRow | undefined;
}

// Approve a request: generate a code, email it, mark the request approved.
export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const req = getRequest(Number(params.id));
  if (!req) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }
  if (req.status !== "pending") {
    return NextResponse.json(
      { error: "This request has already been handled." },
      { status: 409 }
    );
  }
  if (getUserByEmail(req.email)) {
    db.prepare(
      "UPDATE invite_requests SET status = 'approved', handled_at = datetime('now'), handled_by = ? WHERE id = ?"
    ).run(Number(admin.sub), req.id);
    return NextResponse.json(
      { error: "An account with that email already exists." },
      { status: 409 }
    );
  }

  const code = generateUniqueCode();
  db.prepare(
    "INSERT INTO registration_codes (code, note, email, expires_at, created_by) VALUES (?, ?, ?, ?, ?)"
  ).run(
    code,
    `Invite request #${req.id}`,
    req.email,
    expiresAtFromDays(7),
    Number(admin.sub)
  );

  let sent = false;
  try {
    await sendInviteEmail({ to: req.email, code });
    sent = true;
    db.prepare(
      "UPDATE registration_codes SET sent_at = datetime('now') WHERE code = ?"
    ).run(code);
  } catch (err) {
    console.error(`[invite-requests] failed to send invite to ${req.email}:`, err);
  }

  db.prepare(
    "UPDATE invite_requests SET status = 'approved', handled_at = datetime('now'), handled_by = ? WHERE id = ?"
  ).run(Number(admin.sub), req.id);

  return NextResponse.json({ ok: true, code, sent });
}

// Decline a request.
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const req = getRequest(Number(params.id));
  if (!req) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  db.prepare(
    "UPDATE invite_requests SET status = 'declined', handled_at = datetime('now'), handled_by = ? WHERE id = ?"
  ).run(Number(admin.sub), req.id);

  return NextResponse.json({ ok: true });
}
