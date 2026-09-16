import { db, NotificationRow } from "./db";
import { qb, getOne, getAll } from "./kysely";
import { sendPushToUser } from "./push";

// Reads go through the typed Kysely builder; the INSERT in notify() and the
// UPDATE in markAllRead() stay on raw better-sqlite3 (single write path).
const NOTIFICATION_SELECT = () =>
  qb
    .selectFrom("notifications as n")
    .leftJoin("user_profiles as up", "up.user_id", "n.actor_user_id")
    .selectAll("n")
    .select(["up.username as actor_username", "up.avatar_key as actor_avatar_key"]);

// Create a notification and push it to the recipient's live WebSocket sockets
// (same `globalThis.__wsClients` registry the messages route uses — populated by
// the custom server in server.mjs). Self-actions are skipped (you don't get
// notified about your own like/comment).

// Broadcast a system announcement: one 'system' notification row per user
// (including the announcer), pushed live over WS and web push. Returns the
// number of recipients.
export function announce(
  actorId: number,
  message: string,
  href?: string | null
): number {
  const users = getAll<{ id: number }>(qb.selectFrom("users").select("id"));
  const insert = db.prepare(
    `INSERT INTO notifications (user_id, type, actor_user_id, message, href)
     VALUES (?, 'system', ?, ?, ?)`
  );
  const registry = (
    globalThis as unknown as {
      __wsClients?: Map<number, Set<{ send: (data: string) => void }>>;
    }
  ).__wsClients;

  for (const u of users) {
    const result = insert.run(u.id, actorId, message, href ?? null);
    if (registry?.has(u.id)) {
      const row = getOne<NotificationRow>(
        NOTIFICATION_SELECT().where("n.id", "=", Number(result.lastInsertRowid))
      );
      const payload = JSON.stringify({ type: "notification", notification: row });
      registry.get(u.id)?.forEach((ws) => {
        try {
          ws.send(payload);
        } catch {
          /* socket may be closing */
        }
      });
    }
    void sendPushToUser(u.id, {
      title: "Elite",
      body: message,
      url: href || "/messages",
      tag: `notif-system-${u.id}`,
    });
  }
  return users.length;
}

