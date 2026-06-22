import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { qb, getAll } from "@/lib/kysely";
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

  const unreadMessages = getAll<{
    senderId: number;
    email: string;
    cnt: number;
    lastAt: string;
  }>(
    qb
      .selectFrom("messages as m")
      .innerJoin("users as u", "u.id", "m.sender_id")
      .select((eb) => [
        "m.sender_id as senderId",
        "u.email as email",
        eb.fn.countAll<number>().as("cnt"),
        eb.fn.max("m.created_at").as("lastAt"),
      ])
      .where("m.recipient_id", "=", userId)
      .where("m.read_at", "is", null)
      .groupBy("m.sender_id")
  );

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
        action: "requested an invite",
        timestamp: r.createdAt,
        href: "/admin",
      });
    }
  }

  // Unread posts-module notifications (likes/comments/follows).
  const postNotifs = getAll<{
    id: number;
    type: string;
    postId: number | null;
    createdAt: string;
    actor: string | null;
  }>(
    qb
      .selectFrom("notifications as n")
      .leftJoin("user_profiles as up", "up.user_id", "n.actor_user_id")
      .select([
        "n.id",
        "n.type",
        "n.post_id as postId",
        "n.created_at as createdAt",
        "up.username as actor",
      ])
      .where("n.user_id", "=", userId)
      .where("n.read_at", "is", null)
      .orderBy("n.id", "desc")
      .limit(50)
  );

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
