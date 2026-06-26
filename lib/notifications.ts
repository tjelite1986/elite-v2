import { db, NotificationRow, NotificationType } from "./db";
import { qb, getOne, getAll } from "./kysely";
import { sendPushToUser } from "./push";

const NOTIFICATION_VERB: Partial<Record<NotificationType, string>> = {
  like: "liked your post",
  comment: "commented on your post",
  follow: "started following you",
  mention: "mentioned you",
};

// Reads go through the typed Kysely builder; the INSERT in notify() and the
// UPDATE in markAllRead() stay on raw better-sqlite3 (single write path).
const NOTIFICATION_SELECT = () =>
  qb
    .selectFrom("notifications as n")
    .leftJoin("user_profiles as up", "up.user_id", "n.actor_user_id")
    .selectAll("n")
    .select(["up.username as actor_username", "up.avatar_key as actor_avatar_key"]);

interface NotificationWithActor extends NotificationRow {
  actor_username: string | null;
  actor_avatar_key: string | null;
}

// Create a notification and push it to the recipient's live WebSocket sockets
// (same `globalThis.__wsClients` registry the messages route uses — populated by
// the custom server in server.mjs). Self-actions are skipped (you don't get
// notified about your own like/comment).
export function notify(opts: {
  recipientId: number;
  actorId: number;
  type: NotificationType;
  postId?: number | null;
  commentId?: number | null;
}): void {
  if (opts.recipientId === opts.actorId) return;

  const result = db
    .prepare(
      `INSERT INTO notifications (user_id, type, actor_user_id, post_id, comment_id)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      opts.recipientId,
      opts.type,
      opts.actorId,
      opts.postId ?? null,
      opts.commentId ?? null
    );

  const row = getOne<NotificationWithActor>(
    NOTIFICATION_SELECT().where("n.id", "=", Number(result.lastInsertRowid))
  );

  const registry = (
    globalThis as unknown as {
      __wsClients?: Map<number, Set<{ send: (data: string) => void }>>;
    }
  ).__wsClients;
  if (registry) {
    const payload = JSON.stringify({ type: "notification", notification: row });
    registry.get(opts.recipientId)?.forEach((ws) => {
      try {
        ws.send(payload);
      } catch {
        /* socket may be closing */
      }
    });
  }

  // Web push so the recipient is notified even with the app closed.
  const actor = row?.actor_username || "Someone";
  const verb = NOTIFICATION_VERB[opts.type] || "sent you a notification";
  void sendPushToUser(opts.recipientId, {
    title: "Elite",
    body: `${actor} ${verb}`,
    url: opts.postId ? `/posts/p/${opts.postId}` : "/people",
    tag: `notif-${opts.type}-${opts.recipientId}`,
  });
}

export function unreadCount(userId: number): number {
  const r = getOne<{ c: number }>(
    qb
      .selectFrom("notifications")
      .select((eb) => eb.fn.countAll<number>().as("c"))
      .where("user_id", "=", userId)
      .where("read_at", "is", null)
  );
  return r?.c ?? 0;
}

export function listNotifications(userId: number, limit = 40): NotificationRow[] {
  return getAll<NotificationRow>(
    NOTIFICATION_SELECT()
      .where("n.user_id", "=", userId)
      .orderBy("n.id", "desc")
      .limit(limit)
  );
}

export function markAllRead(userId: number): void {
  db.prepare(
    "UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL"
  ).run(userId);
}
