import { NextResponse } from "next/server";
import { sql } from "kysely";
import { db } from "@/lib/db";
import { qb, getAll } from "@/lib/kysely";
import { getSession } from "@/lib/auth";

interface Notification {
  id: string;
  user: string;
  /** Profile handle for the avatar, when the actor is a known profile. */
  handle: string | null;
  action: string;
  timestamp: string;
  href: string;
  read: boolean;
}

// Notifications for the current user:
//  - unread chat messages (grouped by sender; transient — they clear once read)
//  - pending invite requests (admins only; actionable until handled)
//  - announcements from /api/admin/announce INCLUDING already read history, so
//    the list keeps an "Earlier" section after mark-all-read
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = Number(session.sub);

  const notifications: Notification[] = [];

  const unreadMessages = getAll<{
    senderId: number;
    email: string;
    handle: string | null;
    cnt: number;
    lastAt: string;
  }>(
    qb
      .selectFrom("messages as m")
      .innerJoin("users as u", "u.id", "m.sender_id")
      .leftJoin("user_profiles as up", "up.user_id", "m.sender_id")
      .select((eb) => [
        "m.sender_id as senderId",
        "u.email as email",
        "up.username as handle",
        eb.fn.countAll<number>().as("cnt"),
        eb.fn.max("m.created_at").as("lastAt"),
      ])
      .where("m.recipient_id", "=", userId)
      .where("m.read_at", "is", null)
      // Messages from pending/declined requests notify via the Menu's requests
      // inbox instead — only conversations I take part in alert here.
      .where(
        sql<boolean>`(
          EXISTS (SELECT 1 FROM messages ms WHERE ms.sender_id = ${userId} AND ms.recipient_id = m.sender_id)
          OR EXISTS (SELECT 1 FROM dm_contacts c WHERE c.owner_id = ${userId} AND c.peer_id = m.sender_id AND c.status = 'accepted')
        )`
      )
      .groupBy("m.sender_id")
  );

  for (const m of unreadMessages) {
    notifications.push({
      id: `msg-${m.senderId}`,
      user: m.email,
      handle: m.handle,
      action: m.cnt > 1 ? `sent you ${m.cnt} messages` : "sent you a message",
      timestamp: m.lastAt,
      href: "/messages",
      read: false,
    });
  }

  if (session.role === "admin") {
    const pending = getAll<{ id: number; email: string; createdAt: string }>(
      qb
        .selectFrom("invite_requests")
        .select(["id", "email", "created_at as createdAt"])
        .where("status", "=", "pending")
        .orderBy("created_at", "desc")
    );

    for (const r of pending) {
      notifications.push({
        id: `inv-${r.id}`,
        user: r.email,
        handle: null,
        action: "requested an invite",
        timestamp: r.createdAt,
        href: "/admin",
        read: false,
      });
    }
  }

  // Announcements, read and unread — the newest 50 form the history. The
  // like/comment/follow/mention rows this once also carried belonged to the
  // posts module, which became its own app on 2026-09-16 and notifies there.
  const announcements = getAll<{
    id: number;
    createdAt: string;
    readAt: string | null;
    message: string | null;
    href: string | null;
  }>(
    qb
      .selectFrom("notifications as n")
      .select([
        "n.id",
        "n.created_at as createdAt",
        "n.read_at as readAt",
        "n.message",
        "n.href",
      ])
      .where("n.user_id", "=", userId)
      .where("n.type", "=", "system")
      .orderBy("n.id", "desc")
      .limit(50)
  );

  for (const n of announcements) {
    // Free text authored via /api/admin/announce, shown as coming from the app
    // itself.
    notifications.push({
      id: `announce-${n.id}`,
      user: "Elite",
      handle: null,
      action: n.message ?? "has news for you",
      timestamp: n.createdAt,
      href: n.href || "/messages",
      read: n.readAt !== null,
    });
  }

  // Newest first.
  notifications.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return NextResponse.json({
    notifications,
    unreadCount: notifications.filter((n) => !n.read).length,
  });
}

// Mark all unread messages as read (clears message notifications). Invite
// requests stay until an admin handles them.
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = Number(session.sub);
  db.prepare(
    "UPDATE messages SET read_at = datetime('now') WHERE recipient_id = ? AND read_at IS NULL"
  ).run(userId);
  db.prepare(
    "UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL"
  ).run(userId);

  return NextResponse.json({ ok: true });
}
