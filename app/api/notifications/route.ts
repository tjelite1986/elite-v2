import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

interface Notification {
  id: string;
  user: string;
  action: string;
  timestamp: string;
  href: string;
}

// Notifications for the current user, derived from live state:
//  - unread chat messages (grouped by sender)
//  - pending invite requests (admins only)
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = Number(session.sub);

  const notifications: Notification[] = [];

  const unreadMessages = db
    .prepare(
      `SELECT m.sender_id AS senderId, u.email AS email,
              COUNT(*) AS cnt, MAX(m.created_at) AS lastAt
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.recipient_id = ? AND m.read_at IS NULL
       GROUP BY m.sender_id`
    )
    .all(userId) as {
    senderId: number;
    email: string;
    cnt: number;
    lastAt: string;
  }[];

  for (const m of unreadMessages) {
    notifications.push({
      id: `msg-${m.senderId}`,
      user: m.email,
      action: m.cnt > 1 ? `sent you ${m.cnt} messages` : "sent you a message",
      timestamp: m.lastAt,
      href: "/messages",
    });
  }

  if (session.role === "admin") {
    const pending = db
      .prepare(
        `SELECT id, email, created_at AS createdAt
         FROM invite_requests
         WHERE status = 'pending'
         ORDER BY created_at DESC`
      )
      .all() as { id: number; email: string; createdAt: string }[];

    for (const r of pending) {
      notifications.push({
        id: `inv-${r.id}`,
        user: r.email,
        action: "requested an invite",
        timestamp: r.createdAt,
        href: "/admin",
      });
    }
  }

  // Unread posts-module notifications (likes/comments/follows).
  const postNotifs = db
    .prepare(
      `SELECT n.id, n.type, n.post_id AS postId, n.created_at AS createdAt,
              up.username AS actor
         FROM notifications n
         LEFT JOIN user_profiles up ON up.user_id = n.actor_user_id
        WHERE n.user_id = ? AND n.read_at IS NULL
        ORDER BY n.id DESC LIMIT 50`
    )
    .all(userId) as {
    id: number;
    type: string;
    postId: number | null;
    createdAt: string;
    actor: string | null;
  }[];

  const POST_ACTION: Record<string, string> = {
    like: "liked your post",
    comment: "commented on your post",
    follow: "started following you",
    mention: "mentioned you",
  };

  for (const n of postNotifs) {
    const actor = n.actor ?? "someone";
    notifications.push({
      id: `post-${n.id}`,
      user: actor,
      action: POST_ACTION[n.type] ?? "interacted with you",
      timestamp: n.createdAt,
      href: n.type === "follow" ? `/posts/u/${actor}` : `/posts/p/${n.postId ?? ""}`,
    });
  }

  // Newest first.
  notifications.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return NextResponse.json({
    notifications,
    unreadCount: notifications.length,
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
