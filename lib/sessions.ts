import { db } from "./db";

export interface SessionRow {
  jti: string;
  user_id: number;
  user_agent: string | null;
  ip: string | null;
  created_at: string;
  last_seen_at: string;
}

export function createSession(
  jti: string,
  userId: number,
  userAgent: string | null,
  ip: string | null
): void {
  db.prepare(
    `INSERT INTO sessions (jti, user_id, user_agent, ip) VALUES (?, ?, ?, ?)`
  ).run(jti, userId, userAgent?.slice(0, 400) || null, ip?.slice(0, 64) || null);
}

export function sessionExists(jti: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sessions WHERE jti = ?").get(jti));
}

// Refresh last-seen, but only if it's gone stale, to avoid a write on every
// getSession call (which happens several times per page render).
export function touchSession(jti: string): void {
  db.prepare(
    "UPDATE sessions SET last_seen_at = datetime('now') WHERE jti = ? AND last_seen_at < datetime('now', '-2 minutes')"
  ).run(jti);
}

export function listSessions(userId: number): SessionRow[] {
  return db
    .prepare(
      "SELECT * FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC"
    )
    .all(userId) as SessionRow[];
}

// Revoke a specific session (only the caller's own).
export function revokeSession(jti: string, userId: number): void {
  db.prepare("DELETE FROM sessions WHERE jti = ? AND user_id = ?").run(
    jti,
    userId
  );
}

// Revoke every session except the given one (sign out other devices).
export function revokeOtherSessions(keepJti: string, userId: number): void {
  db.prepare("DELETE FROM sessions WHERE user_id = ? AND jti != ?").run(
    userId,
    keepJti
  );
}
