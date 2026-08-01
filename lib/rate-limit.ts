// Simple in-memory sliding-window throttle for a single-box personal hub.
// Resets on process restart — acceptable here (see callers). DB-backed login
// throttle (lib/login-rate-limit.ts) is a separate, heavier-weight ladder and
// not a fit for this use case.
export function makeThrottle(maxAttempts: number, windowMs: number) {
  const failures = new Map<string, { count: number; resetAt: number }>();

  function isLockedOut(key: string): boolean {
    const rec = failures.get(key);
    return !!rec && Date.now() <= rec.resetAt && rec.count >= maxAttempts;
  }

  function recordFailure(key: string): void {
    const now = Date.now();
    const rec = failures.get(key);
    if (!rec || now > rec.resetAt) {
      failures.set(key, { count: 1, resetAt: now + windowMs });
    } else {
      rec.count++;
    }
  }

  function clear(key: string): void {
    failures.delete(key);
  }

  return { isLockedOut, recordFailure, clear };
}
