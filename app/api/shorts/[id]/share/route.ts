import { NextResponse } from "next/server";
import { getSession, getUserById } from "@/lib/auth";
import { db } from "@/lib/db";
import { canAccessChannel, canViewShort, getShort } from "@/lib/shorts";

export const dynamic = "force-dynamic";

// Share a short into a direct-message chat. elite-v2 has no public feed yet, so
// "share" sends the clip to another user as a message attachment (type 'short').
// The recipient still has to clear the 18+ gate to actually play a 18plus clip —
// the media routes enforce that independently.
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const meId = Number(session.sub);

  const short = getShort(Number(params.id));
  if (!short) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!canViewShort(short, meId, session.role === "admin")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // A private clip can't be played by the recipient (the media routes block it),
  // so sharing it would be a dead attachment — require it be public first.
  if (short.is_private) {
    return NextResponse.json(
      { error: "This clip is private — make it public to share." },
      { status: 400 }
    );
  }
  if (!(await canAccessChannel(short.channel))) {
    return NextResponse.json({ error: "Locked" }, { status: 403 });
  }

  const reqBody = await request.json().catch(() => ({}));
  const recipientId = Number(reqBody?.recipientId);
  const note = typeof reqBody?.body === "string" ? reqBody.body.trim() : "";

  if (!recipientId) {
    return NextResponse.json({ error: "Recipient is required." }, { status: 400 });
  }
  if (recipientId === meId) {
    return NextResponse.json({ error: "You cannot message yourself." }, { status: 400 });
  }
  if (!getUserById(recipientId)) {
    return NextResponse.json({ error: "Recipient not found." }, { status: 404 });
  }

  const attachment = {
    id: short.id,
    channel: short.channel,
    caption: short.caption,
    has_poster: Boolean(short.poster_key),
  };

  db.prepare(
    `INSERT INTO messages (sender_id, recipient_id, body, attachment_type, attachment_data)
     VALUES (?, ?, ?, 'short', ?)`
  ).run(meId, recipientId, note.slice(0, 4000), JSON.stringify(attachment));

  return NextResponse.json({ ok: true });
}
