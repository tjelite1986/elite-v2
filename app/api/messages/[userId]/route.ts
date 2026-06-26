import { NextResponse } from "next/server";
import { db, MessageRow } from "@/lib/db";
import { qb, getAll } from "@/lib/kysely";
import { getSession, getUserById } from "@/lib/auth";
import { reactionsForMessages, replyPreview } from "@/lib/message-actions";

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

  const messages = getAll<MessageRow>(
    qb
      .selectFrom("messages")
      .selectAll()
      .where((eb) =>
        eb.or([
          eb.and([
            eb("sender_id", "=", meId),
            eb("recipient_id", "=", otherId),
          ]),
          eb.and([
            eb("sender_id", "=", otherId),
            eb("recipient_id", "=", meId),
          ]),
        ])
      )
      .orderBy("created_at")
      .orderBy("id")
  );

  // Attach reaction summaries + reply previews.
  const reactions = reactionsForMessages(
    "dm",
    messages.map((m) => m.id),
    meId
  );
  const withMeta = messages.map((m) => ({
    ...m,
    reactions: reactions[m.id] ?? [],
    reply: m.reply_to ? replyPreview("dm", m.reply_to) : null,
  }));

  return NextResponse.json({
    messages: withMeta,
    other: { id: other.id, email: other.email },
  });
}
