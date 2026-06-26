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

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
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

  const messages = listMessages(channelId);
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
    is_member: member,
  });
}
