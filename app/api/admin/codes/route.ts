import { NextResponse } from "next/server";
import { db, CodeRow } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { generateUniqueCode, expiresAtFromDays } from "@/lib/codes";
import { sendInviteEmail, isMailConfigured } from "@/lib/mail";

async function requireAdmin() {
  const session = await getSession();
  if (!session || session.role !== "admin") return null;
  return session;
}

function validateEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const codes = db
    .prepare(
      `SELECT c.*, u.email AS used_by_email
       FROM registration_codes c
       LEFT JOIN users u ON u.id = c.used_by
       ORDER BY c.created_at DESC`
    )
    .all() as (CodeRow & { used_by_email: string | null })[];

  return NextResponse.json({ codes, mailConfigured: isMailConfigured() });
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const note: string | undefined = body.note;
  const rawEmails: unknown = body.emails;
  const expiresAt = expiresAtFromDays(
    typeof body.expiresInDays === "number" ? body.expiresInDays : null
  );

  // Email mode: generate one code per address and email each invitation.
  if (Array.isArray(rawEmails)) {
    const emails = rawEmails
      .map((e) => String(e).trim().toLowerCase())
      .filter((e) => e.length > 0);

    const invalid = emails.filter((e) => !validateEmail(e));
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: `Invalid email address: ${invalid[0]}` },
        { status: 400 }
      );
    }
    if (emails.length === 0) {
      return NextResponse.json(
        { error: "Add at least one email address." },
        { status: 400 }
      );
    }

    const results: { email: string; code: string; sent: boolean }[] = [];
    for (const email of emails) {
      const code = generateUniqueCode();
      db.prepare(
        "INSERT INTO registration_codes (code, note, email, expires_at, created_by) VALUES (?, ?, ?, ?, ?)"
      ).run(
        code,
        note ? String(note).slice(0, 200) : null,
        email,
        expiresAt,
        Number(admin.sub)
      );

      let sent = false;
      try {
        await sendInviteEmail({ to: email, code, note });
        sent = true;
        db.prepare(
          "UPDATE registration_codes SET sent_at = datetime('now') WHERE code = ?"
        ).run(code);
      } catch (err) {
        console.error(`[codes] failed to send invite to ${email}:`, err);
      }
      results.push({ email, code, sent });
    }

    return NextResponse.json({ ok: true, results });
  }

  // Plain mode: generate a single unassigned code (no email).
  const code = generateUniqueCode();
  db.prepare(
    "INSERT INTO registration_codes (code, note, expires_at, created_by) VALUES (?, ?, ?, ?)"
  ).run(code, note ? String(note).slice(0, 200) : null, expiresAt, Number(admin.sub));

  return NextResponse.json({ ok: true, code });
}
