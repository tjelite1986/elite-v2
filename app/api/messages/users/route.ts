import { NextResponse } from "next/server";
import { sql } from "kysely";
import { qb, getAll } from "@/lib/kysely";
import { getSession } from "@/lib/auth";

interface ConversationRow {
  id: number;
  email: string;
  username: string | null;
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
  const pair = sql`((m.sender_id = ${meId} AND m.recipient_id = u.id) OR (m.sender_id = u.id AND m.recipient_id = ${meId})) AND m.deleted_at IS NULL`;
  const rows = getAll<ConversationRow>(
    qb
      .selectFrom("users as u")
      // The profile handle drives the avatar URL (/api/profiles/<username>/avatar).
      .leftJoin("user_profiles as up", "up.user_id", "u.id")
      .select([
        "u.id",
        "u.email",
        "up.username",
        // users.last_seen is never written; presence comes from the sessions
        // table, which getSession touches on every authenticated request.
        sql<string | null>`(SELECT MAX(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id)`.as(
          "last_seen"
        ),
        sql<string | null>`(SELECT m.body FROM messages m WHERE ${pair} ORDER BY m.created_at DESC, m.id DESC LIMIT 1)`.as(
          "last_body"
        ),
        sql<string | null>`(SELECT m.attachment_type FROM messages m WHERE ${pair} ORDER BY m.created_at DESC, m.id DESC LIMIT 1)`.as(
          "last_attachment"
        ),
        sql<string | null>`(SELECT m.created_at FROM messages m WHERE ${pair} ORDER BY m.created_at DESC, m.id DESC LIMIT 1)`.as(
          "last_at"
        ),
        sql<number>`(SELECT COUNT(*) FROM messages m WHERE m.sender_id = u.id AND m.recipient_id = ${meId} AND m.read_at IS NULL AND m.deleted_at IS NULL)`.as(
          "unread"
        ),
      ])
      .where("u.id", "!=", meId)
      // Pending or declined message requests live in the Menu's requests inbox,
      // not in the chat list: hide senders I never wrote to and never accepted.
      .where(
        sql<boolean>`NOT (
          EXISTS (SELECT 1 FROM messages mr WHERE mr.sender_id = u.id AND mr.recipient_id = ${meId})
          AND NOT EXISTS (SELECT 1 FROM messages ms WHERE ms.sender_id = ${meId} AND ms.recipient_id = u.id)
          AND NOT EXISTS (SELECT 1 FROM dm_contacts c WHERE c.owner_id = ${meId} AND c.peer_id = u.id AND c.status = 'accepted')
        )`
      )
      .orderBy(sql`last_at desc`)
      .orderBy("u.email")
  );

  return NextResponse.json({ users: rows });
}
