import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getChannel, joinChannel, leaveChannel } from "@/lib/channels";

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
  const { leave } = await request.json().catch(() => ({}));
  if (leave) leaveChannel(channelId, Number(session.sub));
  else joinChannel(channelId, Number(session.sub));
  return NextResponse.json({ ok: true });
}
