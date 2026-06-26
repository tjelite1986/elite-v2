import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  type Scope,
  canAccessMessage,
  toggleReaction,
  broadcastMessageUpdate,
} from "@/lib/message-actions";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { scope, messageId, emoji } = await request.json().catch(() => ({}));
  const id = Number(messageId);
  // Require an emoji-like string (short, no ASCII letters/digits or markup) so
  // reactions can't be abused to store arbitrary text/markup.
  const validEmoji =
    typeof emoji === "string" &&
    emoji.length >= 1 &&
    emoji.length <= 16 &&
    !/[a-zA-Z0-9<>&]/.test(emoji);
  if (
    (scope !== "dm" && scope !== "channel") ||
    !Number.isInteger(id) ||
    !validEmoji
  ) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const userId = Number(session.sub);
  if (!canAccessMessage(scope as Scope, id, userId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  toggleReaction(scope as Scope, id, userId, emoji);
  broadcastMessageUpdate(scope as Scope, id);
  return NextResponse.json({ ok: true });
}
