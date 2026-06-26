import { NextResponse } from "next/server";
import { db, MessageRow } from "@/lib/db";
import { qb, getOne, getAll } from "@/lib/kysely";
import { getSession, getUserById } from "@/lib/auth";
import { sendPushToUser } from "@/lib/push";

interface Attachment {
  type: "photos" | "album";
  data: { ids: number[]; album_name?: string };
}

// Build a validated attachment from the request, or null. Only the sender's own
// (non-deleted) items can be shared; album item ids are snapshotted now.
function buildAttachment(
  meId: number,
  body: { attachmentType?: string; ids?: unknown; albumId?: unknown }
): Attachment | null {
  if (body.attachmentType === "photos") {
    const ids = (Array.isArray(body.ids) ? body.ids : [])
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n));
    if (ids.length === 0) return null;
    const owned = getAll<{ id: number }>(
      qb
        .selectFrom("gallery_items")
        .select("id")
        .where("user_id", "=", meId)
        .where("is_deleted", "=", 0)
        .where("id", "in", ids)
    ).map((r) => r.id);
    if (owned.length === 0) return null;
    return { type: "photos", data: { ids: owned } };
  }

  if (body.attachmentType === "album") {
    const albumId = Number(body.albumId);
    if (!Number.isInteger(albumId)) return null;
    const album = getOne<{ id: number; name: string }>(
      qb
        .selectFrom("gallery_albums")
        .select(["id", "name"])
        .where("id", "=", albumId)
        .where("user_id", "=", meId)
    );
    if (!album) return null;
    const ids = getAll<{ id: number }>(
      qb
        .selectFrom("gallery_album_items as ai")
        .innerJoin("gallery_items as gi", "gi.id", "ai.item_id")
        .select("ai.item_id as id")
        .where("ai.album_id", "=", albumId)
        .where("gi.is_deleted", "=", 0)
        .orderBy("gi.taken_at", "desc")
    ).map((r) => r.id);
    if (ids.length === 0) return null;
    return { type: "album", data: { ids, album_name: album.name } };
  }

  return null;
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const meId = Number(session.sub);

  const reqBody = await request.json().catch(() => ({}));
  const { recipientId, body } = reqBody;

  const trimmed = typeof body === "string" ? body.trim() : "";
  const attachment = buildAttachment(meId, reqBody);

  if (!recipientId) {
    return NextResponse.json({ error: "Recipient is required." }, { status: 400 });
  }
  if (!trimmed && !attachment) {
    return NextResponse.json(
      { error: "A message or an attachment is required." },
      { status: 400 }
    );
  }
  if (Number(recipientId) === meId) {
    return NextResponse.json({ error: "You cannot message yourself." }, { status: 400 });
  }
  if (!getUserById(Number(recipientId))) {
    return NextResponse.json({ error: "Recipient not found." }, { status: 404 });
  }

  const replyTo = Number.isInteger(Number(reqBody.replyTo))
    ? Number(reqBody.replyTo)
    : null;
  const result = db
    .prepare(
      `INSERT INTO messages (sender_id, recipient_id, body, attachment_type, attachment_data, reply_to)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      meId,
      Number(recipientId),
      trimmed.slice(0, 4000),
      attachment ? attachment.type : null,
      attachment ? JSON.stringify(attachment.data) : null,
      replyTo
    );

  const message = getOne<MessageRow>(
    qb.selectFrom("messages").selectAll().where("id", "=", Number(result.lastInsertRowid))
  )!;

  // Push to any live WebSocket clients for both participants (same process —
  // the custom server in server.mjs stores the registry on globalThis).
  const registry = (
    globalThis as unknown as {
      __wsClients?: Map<number, Set<{ send: (data: string) => void }>>;
    }
  ).__wsClients;
  if (registry) {
    const payload = JSON.stringify({ type: "message", message });
    for (const uid of [Number(recipientId), meId]) {
      registry.get(uid)?.forEach((ws) => {
        try {
          ws.send(payload);
        } catch {
          /* socket may be closing */
        }
      });
    }
  }

  // Web push to the recipient so a new DM reaches them with the app closed.
  const senderName =
    getOne<{ username: string }>(
      qb.selectFrom("user_profiles").select("username").where("user_id", "=", meId)
    )?.username || "Someone";
  void sendPushToUser(Number(recipientId), {
    title: senderName,
    body: trimmed ? trimmed.slice(0, 140) : "Sent you an attachment",
    url: "/messages",
    tag: `dm-${meId}`,
  });

  return NextResponse.json({ message });
}
