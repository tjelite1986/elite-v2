import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getChannel,
  joinChannel,
  postMessage,
  markRead,
  memberIds,
} from "@/lib/channels";
import { broadcastToUsers } from "@/lib/ws";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const channelId = Number(params.id);
  if (!getChannel(channelId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const reqBody = await request.json().catch(() => ({}));
  const trimmed = typeof reqBody.body === "string" ? reqBody.body.trim() : "";
  if (!trimmed) {
    return NextResponse.json({ error: "A message is required." }, { status: 400 });
  }
  const replyTo = Number.isInteger(Number(reqBody.replyTo))
    ? Number(reqBody.replyTo)
    : null;

  const userId = Number(session.sub);
  // Posting joins you to the channel (first message auto-subscribes).
  joinChannel(channelId, userId);
  const message = postMessage(channelId, userId, trimmed, replyTo);
  markRead(channelId, userId);

  // Live-update every member's open clients.
  broadcastToUsers(memberIds(channelId), {
    type: "channel_message",
    channelId,
    message,
  });

  return NextResponse.json({ message });
}
