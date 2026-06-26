import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  type Scope,
  editMessage,
  broadcastMessageUpdate,
} from "@/lib/message-actions";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { scope, messageId, body } = await request.json().catch(() => ({}));
  const id = Number(messageId);
  const text = typeof body === "string" ? body.trim() : "";
  if ((scope !== "dm" && scope !== "channel") || !Number.isInteger(id) || !text) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  // editMessage enforces own-message + not-deleted.
  if (!editMessage(scope as Scope, id, Number(session.sub), text)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  broadcastMessageUpdate(scope as Scope, id);
  return NextResponse.json({ ok: true });
}
