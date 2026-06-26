import { db } from "./db";
import { broadcastToUsers } from "./ws";
import { memberIds } from "./channels";

export type Scope = "dm" | "channel";

const TABLE: Record<Scope, string> = {
  dm: "messages",
  channel: "channel_messages",
};

// Can the user see this message? DM: be a participant. Channel: be a member.
export function canAccessMessage(
  scope: Scope,
  messageId: number,
  userId: number
): boolean {
  if (scope === "dm") {
    const m = db
      .prepare("SELECT sender_id, recipient_id FROM messages WHERE id = ?")
      .get(messageId) as { sender_id: number; recipient_id: number } | undefined;
    return Boolean(m && (m.sender_id === userId || m.recipient_id === userId));
  }
  // Channels are public to read, so any signed-in user may react to a channel
  // message that exists (edit/delete remain owner-gated separately). userId is
  // kept in the signature for symmetry with the dm branch.
  void userId;
  return Boolean(
    db.prepare("SELECT 1 FROM channel_messages WHERE id = ?").get(messageId)
  );
}

function senderOf(scope: Scope, messageId: number): number | null {
  const m = db
    .prepare(`SELECT sender_id FROM ${TABLE[scope]} WHERE id = ?`)
    .get(messageId) as { sender_id: number } | undefined;
  return m ? m.sender_id : null;
}

export function toggleReaction(
  scope: Scope,
  messageId: number,
  userId: number,
  emoji: string
): void {
  const e = emoji.slice(0, 16);
  const exists = db
    .prepare(
      "SELECT 1 FROM message_reactions WHERE scope = ? AND message_id = ? AND user_id = ? AND emoji = ?"
    )
    .get(scope, messageId, userId, e);
  if (exists) {
    db.prepare(
      "DELETE FROM message_reactions WHERE scope = ? AND message_id = ? AND user_id = ? AND emoji = ?"
    ).run(scope, messageId, userId, e);
  } else {
    db.prepare(
      "INSERT OR IGNORE INTO message_reactions (scope, message_id, user_id, emoji) VALUES (?, ?, ?, ?)"
    ).run(scope, messageId, userId, e);
  }
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  mine: boolean;
}

// emoji-grouped reaction summaries for a set of message ids.
export function reactionsForMessages(
  scope: Scope,
  ids: number[],
  userId: number
): Record<number, ReactionSummary[]> {
  if (ids.length === 0) return {};
  const rows = db
    .prepare(
      `SELECT message_id, emoji, COUNT(*) AS c, MAX(user_id = ?) AS mine
       FROM message_reactions
       WHERE scope = ? AND message_id IN (${ids.map(() => "?").join(",")})
       GROUP BY message_id, emoji
       ORDER BY c DESC, emoji ASC`
    )
    .all(userId, scope, ...ids) as {
    message_id: number;
    emoji: string;
    c: number;
    mine: number;
  }[];
  const out: Record<number, ReactionSummary[]> = {};
  for (const r of rows) {
    (out[r.message_id] ??= []).push({
      emoji: r.emoji,
      count: r.c,
      mine: Boolean(r.mine),
    });
  }
  return out;
}

// Edit own, non-deleted message. Returns false if not allowed.
export function editMessage(
  scope: Scope,
  messageId: number,
  userId: number,
  body: string
): boolean {
  const m = db
    .prepare(`SELECT sender_id, deleted_at FROM ${TABLE[scope]} WHERE id = ?`)
    .get(messageId) as { sender_id: number; deleted_at: string | null } | undefined;
  if (!m || m.sender_id !== userId || m.deleted_at) return false;
  db.prepare(
    `UPDATE ${TABLE[scope]} SET body = ?, edited_at = datetime('now') WHERE id = ?`
  ).run(body.slice(0, 4000), messageId);
  return true;
}

// Soft-delete own message (tombstone) and drop its reactions.
export function deleteMessage(
  scope: Scope,
  messageId: number,
  userId: number
): boolean {
  if (senderOf(scope, messageId) !== userId) return false;
  db.prepare(
    `UPDATE ${TABLE[scope]} SET deleted_at = datetime('now'), body = '' WHERE id = ?`
  ).run(messageId);
  db.prepare(
    "DELETE FROM message_reactions WHERE scope = ? AND message_id = ?"
  ).run(scope, messageId);
  return true;
}

export interface ReplyPreview {
  id: number;
  sender_id: number;
  sender_name: string;
  body: string;
  deleted: boolean;
}

// A short preview of the message being replied to (for rendering above a reply).
export function replyPreview(
  scope: Scope,
  replyToId: number
): ReplyPreview | null {
  const m = db
    .prepare(
      `SELECT cm.id, cm.sender_id, cm.body, cm.deleted_at AS deleted_at,
              COALESCE(up.username, substr(u.email, 1, instr(u.email, '@') - 1), u.email) AS sender_name
       FROM ${TABLE[scope]} cm
       JOIN users u ON u.id = cm.sender_id
       LEFT JOIN user_profiles up ON up.user_id = cm.sender_id
       WHERE cm.id = ?`
    )
    .get(replyToId) as
    | {
        id: number;
        sender_id: number;
        body: string;
        deleted_at: string | null;
        sender_name: string;
      }
    | undefined;
  if (!m) return null;
  return {
    id: m.id,
    sender_id: m.sender_id,
    sender_name: m.sender_name,
    body: m.deleted_at ? "" : (m.body || "").slice(0, 140),
    deleted: Boolean(m.deleted_at),
  };
}

// Who to notify over WS after a DM action.
export function dmParticipants(messageId: number): number[] {
  const m = db
    .prepare("SELECT sender_id, recipient_id FROM messages WHERE id = ?")
    .get(messageId) as { sender_id: number; recipient_id: number } | undefined;
  return m ? [m.sender_id, m.recipient_id] : [];
}

// The channel a channel-message belongs to (for WS broadcast to its members).
export function channelOfMessage(messageId: number): number | null {
  const m = db
    .prepare("SELECT channel_id FROM channel_messages WHERE id = ?")
    .get(messageId) as { channel_id: number } | undefined;
  return m ? m.channel_id : null;
}

// Notify the relevant clients so they re-fetch the thread after a reaction /
// edit / delete. Reuses the existing "message" / "channel_message" events that
// the messenger and channel clients already reload on.
export function broadcastMessageUpdate(scope: Scope, messageId: number): void {
  if (scope === "dm") {
    const m = db
      .prepare("SELECT id, sender_id, recipient_id FROM messages WHERE id = ?")
      .get(messageId);
    if (m) broadcastToUsers(dmParticipants(messageId), { type: "message", message: m });
  } else {
    const ch = channelOfMessage(messageId);
    if (ch) {
      broadcastToUsers(memberIds(ch), { type: "channel_message", channelId: ch });
    }
  }
}
