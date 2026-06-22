import { randomBytes } from "crypto";
import { db } from "./db";
import { qb, getOne } from "./kysely";

// Generate a human-friendly code like "A1B2-C3D4" (no ambiguous characters).
export function generateCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet[bytes[i] % alphabet.length];
    if (i === 3) out += "-";
  }
  return out;
}

// Resolve an expiry timestamp `N` days from now as a SQLite UTC datetime
// string, or null for codes that never expire.
export function expiresAtFromDays(days: number | null): string | null {
  if (!days || days <= 0) return null;
  const row = db
    .prepare("SELECT datetime('now', ?) AS v")
    .get(`+${Math.floor(days)} days`) as { v: string };
  return row.v;
}

// True if the code carries an expiry that has already passed.
export function isCodeExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const row = db
    .prepare("SELECT (? <= datetime('now')) AS expired")
    .get(expiresAt) as { expired: number };
  return row.expired === 1;
}

// Generate a code guaranteed not to collide with an existing one.
export function generateUniqueCode(): string {
  let code = generateCode();
  for (let i = 0; i < 5; i++) {
    const exists = getOne(
      qb.selectFrom("registration_codes").select("id").where("code", "=", code)
    );
    if (!exists) break;
    code = generateCode();
  }
  return code;
}
