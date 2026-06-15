import { NextResponse } from "next/server";
import { db, MessageRow } from "@/lib/db";
import { getSession, getUserById } from "@/lib/auth";

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
    const placeholders = ids.map(() => "?").join(",");
    const owned = (
      db
        .prepare(
          `SELECT id FROM gallery_items
           WHERE user_id = ? AND is_deleted = 0 AND id IN (${placeholders})`
        )
        .all(meId, ...ids) as { id: number }[]
    ).map((r) => r.id);
    if (owned.length === 0) return null;
    return { type: "photos", data: { ids: owned } };
  }

  if (body.attachmentType === "album") {
    const albumId = Number(body.albumId);
    if (!Number.isInteger(albumId)) return null;
    const album = db
      .prepare("SELECT id, name FROM gallery_albums WHERE id = ? AND user_id = ?")
      .get(albumId, meId) as { id: number; name: string } | undefined;
    if (!album) return null;
    const ids = (
      db
        .prepare(
          `SELECT ai.item_id AS id FROM gallery_album_items ai
           JOIN gallery_items gi ON gi.id = ai.item_id
           WHERE ai.album_id = ? AND gi.is_deleted = 0
           ORDER BY gi.taken_at DESC`
        )
        .all(albumId) as { id: number }[]
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

  const result = db
    .prepare(
      `INSERT INTO messages (sender_id, recipient_id, body, attachment_type, attachment_data)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      meId,
      Number(recipientId),
      trimmed.slice(0, 4000),
      attachment ? attachment.type : null,
      attachment ? JSON.stringify(attachment.data) : null
    );

  const message = db
    .prepare("SELECT * FROM messages WHERE id = ?")
    .get(Number(result.lastInsertRowid)) as MessageRow;

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

  return NextResponse.json({ message });
}
