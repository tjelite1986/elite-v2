import { NextResponse } from "next/server";
import { sql } from "kysely";
import { db } from "@/lib/db";
import { qb, getAll } from "@/lib/kysely";
import { getSession, getUserById } from "@/lib/auth";

interface RequestRow {
  id: number;
  email: string;
  message_count: number;
  last_body: string | null;
  last_at: string | null;
}

// Pending message requests: users who have written to me, whom I have never
// written back to and never accepted or declined. Accepting (or simply
// replying) moves the conversation into Chats; declining hides it.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const meId = Number(session.sub);

  const requests = getAll<RequestRow>(
    qb
      .selectFrom("users as u")
      .select([
        "u.id",
        "u.email",
        sql<number>`(SELECT COUNT(*) FROM messages m WHERE m.sender_id = u.id AND m.recipient_id = ${meId})`.as(
          "message_count"
        ),
        sql<string | null>`(SELECT m.body FROM messages m WHERE m.sender_id = u.id AND m.recipient_id = ${meId} ORDER BY m.created_at DESC, m.id DESC LIMIT 1)`.as(
          "last_body"
        ),
        sql<string | null>`(SELECT MAX(m.created_at) FROM messages m WHERE m.sender_id = u.id AND m.recipient_id = ${meId})`.as(
          "last_at"
        ),
      ])
      .where("u.id", "!=", meId)
      .where(
        sql<boolean>`EXISTS (SELECT 1 FROM messages m WHERE m.sender_id = u.id AND m.recipient_id = ${meId} AND m.deleted_at IS NULL)`
      )
      .where(
        sql<boolean>`NOT EXISTS (SELECT 1 FROM messages m WHERE m.sender_id = ${meId} AND m.recipient_id = u.id)`
      )
      .where(
        sql<boolean>`NOT EXISTS (SELECT 1 FROM dm_contacts c WHERE c.owner_id = ${meId} AND c.peer_id = u.id)`
      )
      .orderBy(sql`last_at desc`)
  );

  return NextResponse.json({ requests, count: requests.length });
}

// Accept or decline a pending request (upsert — re-deciding is allowed).
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const meId = Number(session.sub);

  const body = await request.json().catch(() => null);
  const peerId = Number(body?.peerId);
  const action = body?.action;
  if (!Number.isInteger(peerId) || peerId === meId || !getUserById(peerId)) {
    return NextResponse.json({ error: "Invalid peer." }, { status: 400 });
  }
  if (action !== "accept" && action !== "decline") {
    return NextResponse.json(
      { error: "action must be accept or decline." },
      { status: 400 }
    );
  }

  const status = action === "accept" ? "accepted" : "declined";
  db.prepare(
    `INSERT INTO dm_contacts (owner_id, peer_id, status) VALUES (?, ?, ?)
     ON CONFLICT(owner_id, peer_id) DO UPDATE SET status = excluded.status,
       created_at = datetime('now')`
  ).run(meId, peerId, status);

  return NextResponse.json({ ok: true, status });
}
