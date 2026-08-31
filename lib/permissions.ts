import { db } from "./db";
import { getShowAppstore } from "./profiles";

// Per-section settings-page capabilities an admin can grant individual users.
// Admins implicitly hold every permission (no rows needed). Keep these keys in
// sync with the settings pages + section layouts that gate on them.
export const PERMISSIONS = [
  { key: "shorts_settings", label: "Shorts settings" },
  { key: "shorts18_settings", label: "18+ settings" },
  { key: "posts_settings", label: "Posts settings" },
  { key: "gallery_settings", label: "Gallery settings" },
  { key: "appstore", label: "App Store" },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];
export const PERMISSION_KEYS: PermissionKey[] = PERMISSIONS.map((p) => p.key);

// Keys every account starts with, rather than waiting for an admin to hand them
// over. The App Store is one: it was open to everyone before this permission
// existed, so making it opt-in would have quietly taken it away from every
// account that already had it. A row is still written per user — the grant
// table stays the single source of truth, and Admin -> Permissions can revoke
// it like any other. See migrate() in lib/db.ts and the register route.
export const DEFAULT_GRANTED: readonly PermissionKey[] = ["appstore"];

// Give one account the keys everybody starts with. Safe to call twice.
export function grantDefaultPermissions(userId: number): void {
  const ins = db.prepare(
    "INSERT OR IGNORE INTO user_permissions (user_id, permission) VALUES (?, ?)"
  );
  for (const k of DEFAULT_GRANTED) ins.run(userId, k);
}

function isKey(k: string): k is PermissionKey {
  return (PERMISSION_KEYS as string[]).includes(k);
}

export function getUserPermissions(userId: number): PermissionKey[] {
  return (
    db
      .prepare("SELECT permission FROM user_permissions WHERE user_id = ?")
      .all(userId) as { permission: string }[]
  )
    .map((r) => r.permission)
    .filter(isKey);
}

// True if the session may enter a permission-gated area: admins always; everyone
// else only when granted that exact key. Pass the getSession() result.
export function hasPermission(
  session: { sub?: string | number; role?: string } | null | undefined,
  key: PermissionKey
): boolean {
  if (!session) return false;
  if (session.role === "admin") return true;
  const userId = Number(session.sub);
  if (!Number.isInteger(userId)) return false;
  return Boolean(
    db
      .prepare("SELECT 1 FROM user_permissions WHERE user_id = ? AND permission = ?")
      .get(userId, key)
  );
}

// Section guard for the shorts APIs: channel-scoped calls need that channel's
// settings permission; cross-channel calls (dupe scan/resolve, action=all)
// need both. Admins pass implicitly via hasPermission.
export function hasShortsPermission(
  session: { sub?: string | number; role?: string } | null | undefined,
  channel?: "main" | "18plus"
): boolean {
  if (channel === "18plus") return hasPermission(session, "shorts18_settings");
  if (channel === "main") return hasPermission(session, "shorts_settings");
  return (
    hasPermission(session, "shorts_settings") &&
    hasPermission(session, "shorts18_settings")
  );
}

// Replace a user's granted permissions with the given valid set (admin action).
export function setUserPermissions(userId: number, keys: string[]): void {
  const valid = Array.from(new Set(keys.filter(isKey)));
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM user_permissions WHERE user_id = ?").run(userId);
    const ins = db.prepare(
      "INSERT OR IGNORE INTO user_permissions (user_id, permission) VALUES (?, ?)"
    );
    for (const k of valid) ins.run(userId, k);
  });
  tx();
}

// Whether the App Store's way in should be drawn for this session: two
// questions, deliberately separate. The permission answers whether the account
// may reach the store at all — an admin decision. The profile flag answers
// whether the person wants the row and the tile — theirs. The store itself
// stays reachable at its own address either way; hiding a link is not access
// control, and pretending otherwise would put the only guard in the chrome.
export function showsAppstore(
  session: { sub?: string | number; role?: string } | null | undefined
): boolean {
  if (!hasPermission(session, "appstore")) return false;
  const userId = Number(session?.sub);
  if (!Number.isInteger(userId)) return false;
  return getShowAppstore(userId);
}
