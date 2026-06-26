import { db } from "./db";

// DB-backed login throttle, keyed by a normalized identifier (the lowercased
// login email). A ladder of failure thresholds escalates the lockout duration,
// blunting brute-force/credential-stuffing against a targeted account. A
// successful login clears the counter. Ported from the original Elite hub.

interface AttemptRow {
  identifier: string;
  fails: number;
  first_fail_at: string;
  last_fail_at: string;
  locked_until: string | null;
}

// Highest threshold first — the first match wins.
const LADDER: { atFails: number; lockMs: number }[] = [
  { atFails: 20, lockMs: 4 * 60 * 60 * 1000 },
  { atFails: 10, lockMs: 30 * 60 * 1000 },
  { atFails: 5, lockMs: 5 * 60 * 1000 },
];

// With no failures for this long, an existing counter is considered stale and
// reset on the next failure so a long-idle account starts fresh.
const STALE_AFTER_MS = 4 * 60 * 60 * 1000;

function norm(identifier: string): string {
  return identifier.trim().toLowerCase();
}

function msUntil(iso: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso.replace(" ", "T") + "Z").getTime();
  if (isNaN(t)) return 0;
  return t - Date.now();
}

/**
 * Returns how many seconds the caller must wait, or 0 if a login attempt is
 * currently allowed. Call before verifying the password.
 */
export function loginLockRemainingSec(identifier: string): number {
  const row = db
    .prepare("SELECT * FROM login_attempts WHERE identifier = ?")
    .get(norm(identifier)) as AttemptRow | undefined;
  if (!row) return 0;
  const remaining = msUntil(row.locked_until);
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

/**
 * Record a failed login. Increments the counter and, when a ladder threshold is
 * reached, sets a lockout. Returns the lockout seconds now in effect (0 if none).
 */
export function recordLoginFailure(identifier: string): number {
  const id = norm(identifier);
  const row = db
    .prepare("SELECT * FROM login_attempts WHERE identifier = ?")
    .get(id) as AttemptRow | undefined;

  // Reset a stale counter (no activity for a long time and not currently locked).
  const stale =
    row && msUntil(row.locked_until) <= 0 && -msUntil(row.last_fail_at) > STALE_AFTER_MS;

  const fails = !row || stale ? 1 : row.fails + 1;
  const tier = LADDER.find((t) => fails >= t.atFails);
  const lockedUntil = tier
    ? new Date(Date.now() + tier.lockMs).toISOString().replace("T", " ").slice(0, 19)
    : null;

  db.prepare(
    `INSERT INTO login_attempts (identifier, fails, first_fail_at, last_fail_at, locked_until)
     VALUES (?, ?, datetime('now'), datetime('now'), ?)
     ON CONFLICT(identifier) DO UPDATE SET
       fails = excluded.fails,
       last_fail_at = datetime('now'),
       locked_until = excluded.locked_until`
  ).run(id, fails, lockedUntil);

  return tier ? Math.ceil(tier.lockMs / 1000) : 0;
}

/** Clear the failure counter for an identifier after a successful login. */
export function clearLoginFailures(identifier: string): void {
  db.prepare("DELETE FROM login_attempts WHERE identifier = ?").run(
    norm(identifier)
  );
}
