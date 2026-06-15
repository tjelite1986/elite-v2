import { scryptSync, randomBytes, timingSafeEqual } from "crypto";

// Password hashing using Node's built-in scrypt (no native dependency).
// Format stored in the DB: "<salt-hex>:<derived-hex>".
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, derivedHex] = stored.split(":");
  if (!salt || !derivedHex) return false;
  const derived = Buffer.from(derivedHex, "hex");
  const candidate = scryptSync(password, salt, 64);
  if (derived.length !== candidate.length) return false;
  return timingSafeEqual(derived, candidate);
}
