import { NextResponse } from "next/server";
import { db, MessageRow } from "@/lib/db";
import { getSession, getUserById } from "@/lib/auth";

export async function GET(
  _request: Request,
  { params }: { params: { userId: string } }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const meId = Number(session.sub);
  const otherId = Number(params.userId);

  const other = getUserById(otherId);
  if (!other) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  // Mark messages from the other user to me as read.
  db.prepare(
    `UPDATE messages SET read_at = datetime('now')
     WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL`
  ).run(otherId, meId);

  const messages = db
    .prepare(
      `SELECT * FROM messages
       WHERE (sender_id = @me AND recipient_id = @other)
          OR (sender_id = @other AND recipient_id = @me)
       ORDER BY created_at ASC, id ASC`
    )
    .all({ me: meId, other: otherId }) as MessageRow[];

  return NextResponse.json({
    messages,
    other: { id: other.id, email: other.email },
  });
}
