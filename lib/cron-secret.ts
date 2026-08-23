import { timingSafeEqual } from "node:crypto";

// Constant-time secret comparison so a cron/scheduler shared secret can't be
// probed with a timing oracle. Length is compared first (timingSafeEqual
// requires equal-length buffers).
export function secretMatches(presented: string | null, secret: string | undefined): boolean {
  if (!presented || !secret) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
