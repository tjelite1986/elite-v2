import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUserByEmail } from "@/lib/auth";
import { sendInviteRequestNotification } from "@/lib/mail";

function validateEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Public endpoint: a prospective member asks the admin for an invite.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const message = body.message ? String(body.message).slice(0, 1000) : null;

  if (!validateEmail(email)) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 }
    );
  }

  // Don't reveal whether an account exists; just accept silently.
  if (getUserByEmail(email)) {
    return NextResponse.json({ ok: true });
  }

  // Collapse repeated pending requests from the same address.
  const existing = db
    .prepare(
      "SELECT id FROM invite_requests WHERE email = ? AND status = 'pending'"
    )
    .get(email);

  if (!existing) {
    db.prepare(
      "INSERT INTO invite_requests (email, message) VALUES (?, ?)"
    ).run(email, message);
  }

  // Notify the admin by email (best effort).
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) {
    try {
      await sendInviteRequestNotification({
        adminEmail,
        requesterEmail: email,
        message,
      });
    } catch (err) {
      console.error("[invite-requests] failed to notify admin:", err);
    }
  }

  return NextResponse.json({ ok: true });
}
