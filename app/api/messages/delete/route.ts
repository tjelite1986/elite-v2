import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  type Scope,
  deleteMessage,
  broadcastMessageUpdate,
} from "@/lib/message-actions";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { scope, messageId } = await request.json().catch(() => ({}));
  const id = Number(messageId);
  if ((scope !== "dm" && scope !== "channel") || !Number.isInteger(id)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  // broadcast BEFORE the row is gone (soft delete keeps it, but be explicit).
  if (!deleteMessage(scope as Scope, id, Number(session.sub))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  broadcastMessageUpdate(scope as Scope, id);
  return NextResponse.json({ ok: true });
}
