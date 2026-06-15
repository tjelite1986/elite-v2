import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

interface ConversationRow {
  id: number;
  email: string;
  last_seen: string | null;
  last_body: string | null;
  last_attachment: string | null;
  last_at: string | null;
  unread: number;
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const meId = Number(session.sub);

  // All other users, with the latest message in the pair and unread count.
  const rows = db
    .prepare(
      `SELECT
         u.id,
         u.email,
         u.last_seen,
         (SELECT m.body FROM messages m
            WHERE (m.sender_id = @me AND m.recipient_id = u.id)
               OR (m.sender_id = u.id AND m.recipient_id = @me)
            ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_body,
         (SELECT m.attachment_type FROM messages m
            WHERE (m.sender_id = @me AND m.recipient_id = u.id)
               OR (m.sender_id = u.id AND m.recipient_id = @me)
            ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_attachment,
         (SELECT m.created_at FROM messages m
            WHERE (m.sender_id = @me AND m.recipient_id = u.id)
               OR (m.sender_id = u.id AND m.recipient_id = @me)
            ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_at,
         (SELECT COUNT(*) FROM messages m
            WHERE m.sender_id = u.id AND m.recipient_id = @me
              AND m.read_at IS NULL) AS unread
       FROM users u
       WHERE u.id != @me
       ORDER BY last_at DESC, u.email ASC`
    )
    .all({ me: meId }) as ConversationRow[];

  return NextResponse.json({ users: rows });
}
