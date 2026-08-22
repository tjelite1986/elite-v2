import { NextResponse } from "next/server";
import { db, MessageRow } from "@/lib/db";
import { qb, getAll } from "@/lib/kysely";
import { getSession, getUserById } from "@/lib/auth";
import { reactionsForMessages, replyPreview } from "@/lib/message-actions";

// Latest page of messages, newest-first LIMIT then reversed for display —
// mirrors lib/channels.ts listMessages() so a long thread can't stall the
// request or pin memory. `?before=<messageId>` pages backwards.
const PAGE_SIZE = 200;

export async function GET(request: Request, props: { params: Promise<{ userId: string }> }) {
  const params = await props.params;
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

  const beforeParam = new URL(request.url).searchParams.get("before");
  const before = beforeParam ? Number(beforeParam) : null;

  // Mark messages from the other user to me as read.
  db.prepare(
    `UPDATE messages SET read_at = datetime('now')
     WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL`
  ).run(otherId, meId);

  const rows = getAll<MessageRow>(
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
      .$if(before !== null && Number.isFinite(before), (q) =>
        q.where("id", "<", before as number)
      )
      .orderBy("id", "desc")
      .limit(PAGE_SIZE + 1)
  );
  const hasMore = rows.length > PAGE_SIZE;
  if (hasMore) rows.length = PAGE_SIZE;
  const messages = rows.reverse();

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
    other: { id: other.id },
    has_more: hasMore,
  });
}
