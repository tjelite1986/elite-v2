import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { getSession, getUserById } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";
import { SESSION_COOKIE } from "@/lib/session";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = getUserById(Number(session.sub));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Admins cannot delete their own account.
  if (user.role === "admin") {
    return NextResponse.json(
      { error: "Admin accounts cannot be deleted." },
      { status: 403 }
    );
  }

  const { password } = await request.json().catch(() => ({}));
  if (!password) {
    return NextResponse.json(
      { error: "Password is required to delete your account." },
      { status: 400 }
    );
  }

  if (!verifyPassword(password, user.password_hash)) {
    return NextResponse.json(
      { error: "Password is incorrect." },
      { status: 403 }
    );
  }

  // Release/remove FK references before deleting the user:
  // - codes this user consumed become available again
  // - codes this user created lose their creator reference
  // - messages to/from this user are removed
  const deleteAccount = db.transaction(() => {
    db.prepare(
      "UPDATE registration_codes SET used_by = NULL, used_at = NULL WHERE used_by = ?"
    ).run(user.id);
    db.prepare(
      "UPDATE registration_codes SET created_by = NULL WHERE created_by = ?"
    ).run(user.id);
    db.prepare(
      "DELETE FROM messages WHERE sender_id = ? OR recipient_id = ?"
    ).run(user.id, user.id);
    db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
  });

  deleteAccount();

  cookies().delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
