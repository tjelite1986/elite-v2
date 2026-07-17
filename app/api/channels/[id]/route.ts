import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getChannel,
  listMessages,
  isMember,
  markRead,
} from "@/lib/channels";
import { reactionsForMessages, replyPreview } from "@/lib/message-actions";

export const dynamic = "force-dynamic";

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const channelId = Number(params.id);
  const channel = getChannel(channelId);
  if (!channel) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const userId = Number(session.sub);
  const member = isMember(channelId, userId);
  if (member) markRead(channelId, userId);

  // ?before=<messageId> pages backwards through history.
  const beforeParam = new URL(request.url).searchParams.get("before");
  const before = beforeParam ? Number(beforeParam) : null;
  const { messages, hasMore } = listMessages(
    channelId,
    200,
    Number.isFinite(before as number) ? before : null
  );
  const reactions = reactionsForMessages(
    "channel",
    messages.map((m) => m.id),
    userId
  );
  const withMeta = messages.map((m) => ({
    ...m,
    reactions: reactions[m.id] ?? [],
    reply: m.reply_to ? replyPreview("channel", m.reply_to) : null,
  }));

  return NextResponse.json({
    channel,
    messages: withMeta,
    has_more: hasMore,
    is_member: member,
  });
}
