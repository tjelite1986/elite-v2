import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { qb, getOne } from "@/lib/kysely";
import { getUserByEmail } from "@/lib/auth";
import {
  loginLockRemainingSec,
  recordLoginFailure,
} from "@/lib/login-rate-limit";
import { sendInviteRequestNotification } from "@/lib/mail";

function validateEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Public endpoint: a prospective member asks the admin for an invite.
export async function POST(request: Request) {
  // Rate-limit by client IP on the same escalating ladder as failed logins —
  // every request counts, capping how fast this unauthenticated endpoint can
  // spam the admin mailbox and the invite_requests table.
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limiterKey = `invite-req:${ip}`;
  if (loginLockRemainingSec(limiterKey) > 0) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 }
    );
  }
  recordLoginFailure(limiterKey);

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
  const existing = getOne(
    qb
      .selectFrom("invite_requests")
      .select("id")
      .where("email", "=", email)
      .where("status", "=", "pending")
  );

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
