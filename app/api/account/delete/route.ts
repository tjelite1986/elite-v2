import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, getUserById } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";
import { sessionClearCookieHeaders } from "@/lib/session";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Act-as sessions must not reach account self-service: the admin knows the
  // content-owner passwords, so the password check alone is not a barrier.
  if (session.imp) {
    return NextResponse.json(
      { error: "Cannot delete an account while acting as it." },
      { status: 403 }
    );
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
  // - the user's content and social rows are removed so nothing points at a
  //   missing user id and the handle is freed (tables with ON DELETE CASCADE
  //   clean themselves when the users row goes). Media files on disk are left
  //   for the orphan cleanup rather than unlinked mid-transaction.
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
    db.prepare("DELETE FROM posts WHERE author_user_id = ?").run(user.id);
    db.prepare("DELETE FROM post_likes WHERE user_id = ?").run(user.id);
    db.prepare("DELETE FROM post_comments WHERE user_id = ?").run(user.id);
    db.prepare("DELETE FROM stories WHERE author_user_id = ?").run(user.id);
    db.prepare("DELETE FROM story_views WHERE user_id = ?").run(user.id);
    db.prepare(
      "DELETE FROM follows WHERE follower_id = ? OR (target_type = 'user' AND target_id = ?)"
    ).run(user.id, user.id);
    db.prepare(
      "DELETE FROM notifications WHERE user_id = ? OR actor_user_id = ?"
    ).run(user.id, user.id);
    db.prepare("DELETE FROM gallery_albums WHERE user_id = ?").run(user.id);
    db.prepare("DELETE FROM gallery_items WHERE user_id = ?").run(user.id);
    db.prepare(
      "UPDATE shorts SET is_deleted = 1, uploader_id = NULL WHERE uploader_id = ?"
    ).run(user.id);
    db.prepare("DELETE FROM user_profiles WHERE user_id = ?").run(user.id);
    db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
  });

  deleteAccount();

  const res = NextResponse.json({ ok: true });
  for (const header of sessionClearCookieHeaders()) {
    res.headers.append("set-cookie", header);
  }
  return res;
}
