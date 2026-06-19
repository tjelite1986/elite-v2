import { db, NotificationRow, NotificationType } from "./db";

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

  const row = db
    .prepare(
      `SELECT n.*, up.username AS actor_username, up.avatar_key AS actor_avatar_key
         FROM notifications n
         LEFT JOIN user_profiles up ON up.user_id = n.actor_user_id
        WHERE n.id = ?`
    )
    .get(Number(result.lastInsertRowid));

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
}

export function unreadCount(userId: number): number {
  return (
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL"
      )
      .get(userId) as { c: number }
  ).c;
}

export function listNotifications(userId: number, limit = 40): NotificationRow[] {
  return db
    .prepare(
      `SELECT n.*, up.username AS actor_username, up.avatar_key AS actor_avatar_key
         FROM notifications n
         LEFT JOIN user_profiles up ON up.user_id = n.actor_user_id
        WHERE n.user_id = ?
        ORDER BY n.id DESC LIMIT ?`
    )
    .all(userId, limit) as NotificationRow[];
}

export function markAllRead(userId: number): void {
  db.prepare(
    "UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL"
  ).run(userId);
}
