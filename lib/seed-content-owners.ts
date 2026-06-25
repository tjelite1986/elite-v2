import { db } from "./db";
import { ensureUserProfile } from "./profiles";
import { ensureUserHome } from "./shorts-storage";

// Give the env-seeded content-owner accounts (public@/adults@) a public profile
// (username/handle) + per-user home tree, mirroring registration. Kept in its own
// module with normal top-level imports (not inline require()s in db.ts) so the
// db -> profiles/shorts-storage bindings resolve cleanly. db.ts require()s this
// lazily on a deferred tick, after db.ts has finished initializing, so the
// db<->profiles<->kysely import cycle is already resolved. Idempotent.
const CONTENT_OWNER_EMAIL_VARS = ["PUBLIC_EMAIL", "ADULTS_EMAIL"] as const;

export function provisionContentOwners() {
  for (const emailVar of CONTENT_OWNER_EMAIL_VARS) {
    const email = process.env[emailVar];
    if (!email) continue;
    try {
      const row = db
        .prepare("SELECT id FROM users WHERE email = ?")
        .get(email.toLowerCase()) as { id: number } | undefined;
      if (!row) continue;
      const profile = ensureUserProfile(row.id, email.toLowerCase());
      ensureUserHome(row.id, profile.username);
    } catch (err) {
      console.error(
        "Content-owner provisioning skipped:",
        (err as Error).message
      );
    }
  }
}
