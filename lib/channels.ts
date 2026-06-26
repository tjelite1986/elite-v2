import { db } from "./db";

export interface ChannelRow {
  id: number;
  name: string;
  description: string | null;
  created_by: number | null;
  created_at: string;
}

export interface ChannelListItem extends ChannelRow {
  is_member: number;
  member_count: number;
  unread: number;
  last_body: string | null;
  last_at: string | null;
}

export interface ChannelMessage {
  id: number;
  channel_id: number;
  sender_id: number;
  sender_name: string;
  body: string;
  reply_to: number | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

export function listChannels(userId: number): ChannelListItem[] {
  return db
    .prepare(
      `SELECT c.*,
         EXISTS(SELECT 1 FROM channel_members m WHERE m.channel_id = c.id AND m.user_id = @uid) AS is_member,
         (SELECT COUNT(*) FROM channel_members m WHERE m.channel_id = c.id) AS member_count,
         (SELECT body FROM channel_messages cm WHERE cm.channel_id = c.id ORDER BY cm.id DESC LIMIT 1) AS last_body,
         (SELECT created_at FROM channel_messages cm WHERE cm.channel_id = c.id ORDER BY cm.id DESC LIMIT 1) AS last_at,
         (SELECT COUNT(*) FROM channel_messages cm
            WHERE cm.channel_id = c.id AND cm.sender_id != @uid
              AND cm.created_at > COALESCE(
                (SELECT last_read_at FROM channel_members m WHERE m.channel_id = c.id AND m.user_id = @uid), '')
         ) AS unread
       FROM channels c
       ORDER BY (last_at IS NULL), last_at DESC, c.name`
    )
    .all({ uid: userId }) as ChannelListItem[];
}

export function getChannel(id: number): ChannelRow | undefined {
  return db.prepare("SELECT * FROM channels WHERE id = ?").get(id) as
    | ChannelRow
    | undefined;
}

export function isMember(channelId: number, userId: number): boolean {
  return Boolean(
    db
      .prepare(
        "SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?"
      )
      .get(channelId, userId)
  );
}

export function createChannel(
  userId: number,
  name: string,
  description: string | null
): ChannelRow {
  const result = db
    .prepare("INSERT INTO channels (name, description, created_by) VALUES (?, ?, ?)")
    .run(name.slice(0, 80), description?.slice(0, 280) || null, userId);
  const id = Number(result.lastInsertRowid);
  joinChannel(id, userId);
  return getChannel(id)!;
}

export function joinChannel(channelId: number, userId: number): void {
  db.prepare(
    "INSERT OR IGNORE INTO channel_members (channel_id, user_id) VALUES (?, ?)"
  ).run(channelId, userId);
}

export function leaveChannel(channelId: number, userId: number): void {
  db.prepare(
    "DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?"
  ).run(channelId, userId);
}

export function memberIds(channelId: number): number[] {
  return (
    db
      .prepare("SELECT user_id FROM channel_members WHERE channel_id = ?")
      .all(channelId) as { user_id: number }[]
  ).map((r) => r.user_id);
}

export function listMessages(channelId: number, limit = 200): ChannelMessage[] {
  return db
    .prepare(
      `SELECT cm.id, cm.channel_id, cm.sender_id, cm.body, cm.reply_to,
              cm.edited_at, cm.deleted_at, cm.created_at,
              COALESCE(up.username, substr(u.email, 1, instr(u.email, '@') - 1), u.email) AS sender_name
       FROM channel_messages cm
       JOIN users u ON u.id = cm.sender_id
       LEFT JOIN user_profiles up ON up.user_id = cm.sender_id
       WHERE cm.channel_id = ?
       ORDER BY cm.id ASC
       LIMIT ?`
    )
    .all(channelId, limit) as ChannelMessage[];
}

export function postMessage(
  channelId: number,
  senderId: number,
  body: string,
  replyTo: number | null = null
): ChannelMessage {
  const result = db
    .prepare(
      "INSERT INTO channel_messages (channel_id, sender_id, body, reply_to) VALUES (?, ?, ?, ?)"
    )
    .run(channelId, senderId, body.slice(0, 4000), replyTo);
  return db
    .prepare(
      `SELECT cm.id, cm.channel_id, cm.sender_id, cm.body, cm.reply_to,
              cm.edited_at, cm.deleted_at, cm.created_at,
              COALESCE(up.username, substr(u.email, 1, instr(u.email, '@') - 1), u.email) AS sender_name
       FROM channel_messages cm
       JOIN users u ON u.id = cm.sender_id
       LEFT JOIN user_profiles up ON up.user_id = cm.sender_id
       WHERE cm.id = ?`
    )
    .get(Number(result.lastInsertRowid)) as ChannelMessage;
}

export function markRead(channelId: number, userId: number): void {
  db.prepare(
    "UPDATE channel_members SET last_read_at = datetime('now') WHERE channel_id = ? AND user_id = ?"
  ).run(channelId, userId);
}
