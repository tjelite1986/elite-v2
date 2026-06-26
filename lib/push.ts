import webpush from "web-push";
import { db } from "./db";

// Web Push (VAPID) sender. Configured from env; a no-op when keys are absent so
// the app keeps working in dev / before keys are provisioned.
const PUBLIC = process.env.VAPID_PUBLIC_KEY || "";
const PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@mecloud.win";

let configured = false;
function ensureConfigured(): boolean {
  if (!PUBLIC || !PRIVATE) return false;
  if (!configured) {
    webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE);
    configured = true;
  }
  return true;
}

export function pushPublicKey(): string {
  return PUBLIC;
}

interface SubRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
}

export function saveSubscription(
  userId: number,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } }
): void {
  db.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET
       user_id = excluded.user_id,
       p256dh = excluded.p256dh,
       auth = excluded.auth`
  ).run(userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth);
}

export function removeSubscription(endpoint: string): void {
  db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
}

// Fire-and-forget delivery to every registered device of a user. Dead endpoints
// (404/410) are pruned. Never throws — callers can ignore the promise.
export async function sendPushToUser(
  userId: number,
  payload: PushPayload
): Promise<void> {
  if (!ensureConfigured()) return;
  const subs = db
    .prepare(
      "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?"
    )
    .all(userId) as SubRow[];
  if (subs.length === 0) return;

  const data = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          data
        );
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(s.id);
        }
      }
    })
  );
}
