import fs from "node:fs";
import path from "node:path";

// Single source of truth for elite-v2 storage roots and the per-user folder
// layout. In production each root is a bind-mounted host folder under
// /mnt/4tb/elitev2 (see docker2/compose/elitev2/docker-compose.yml); the defaults
// under DATA_DIR keep dev/test self-contained.
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");

// Permanent per-user content home: <PROFILE_ROOT>/u_<user>/<section>/...
export const PROFILE_ROOT =
  process.env.PROFILE_ROOT || path.join(DATA_DIR, "profile");

// Top-level staging area, deliberately SEPARATE from PROFILE_ROOT so the drop
// tree (where files are placed for ingest) never mixes with served storage:
//   <IMPORT_ROOT>/u_<user>/{gallery,books}
export const IMPORT_ROOT =
  process.env.IMPORT_ROOT || path.join(DATA_DIR, "_import");

// Shared book library — NOT per-user. Every account reads the same shelf; only
// reading progress is per-user (in the DB). A user drops a book into their own
// _import/books folder and it is ingested into this shared root.
export const BOOKS_ROOT =
  process.env.BOOKS_ROOT || path.join(DATA_DIR, "books");

// Per-user permanent sections under PROFILE_ROOT/u_<user>/. Books is intentionally
// absent (shared library); `cookies` holds per-user service cookies. Neither
// shorts section is created any more, and neither is posts: all three libraries
// left this app (main shorts 2026-08-31, 18+ shorts 2026-09-15, posts
// 2026-09-16) and the uploads that lived here went with them.
export const PROFILE_SECTIONS = [
  "gallery",
  "cookies",
] as const;

// True when the directory exists and holds at least one entry. A production
// media root is a bind mount that always has content, so a missing or empty
// root almost certainly means the volume is not mounted — callers must not
// treat "file not found" as meaningful in that state (e.g. orphan scans would
// classify the entire library as deletable).
export function storageRootAvailable(dir: string): boolean {
  try {
    return fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

// Per-user drop sections under IMPORT_ROOT/u_<user>/. Books IS present here — the
// dropped file is staged per user but ingested into the shared BOOKS_ROOT.
// Neither shorts section is here, and neither is posts: those libraries are
// separate apps now, and a folder nothing imports from is worse than no folder.
// Existing ones are left on disk untouched.
export const IMPORT_SECTIONS = [
  "gallery",
  "books",
] as const;

// --- Per-user home -------------------------------------------------------

// Filesystem-safe folder name for a name, so a folder always maps to one slug.
function slugify(name: string | null | undefined): string {
  const slug = (name || "unknown")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 64);
  return slug || "unknown";
}

// Per-user home folder name for an account (filesystem-safe), e.g. "u_anna".
// Falls back to the numeric id when the user has no username yet.
export function userHomeDir(userId: number, username?: string | null): string {
  const slug = username ? slugify(username) : "unknown";
  return `u_${slug && slug !== "unknown" ? slug : userId}`;
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Drop folders need to be writable by whoever places files there (e.g. a Samba
// user that differs from the container uid), so the leaf import dirs are opened
// up. Best effort — a chmod failure must not break provisioning.
function makeDroppable(dir: string) {
  try {
    fs.chmodSync(dir, 0o777);
  } catch {
    /* best effort */
  }
}

// Pre-create a user's per-user home up front (instead of lazily on first upload),
// so every account has the same browsable layout from day one:
//   <PROFILE_ROOT>/<userHome>/<PROFILE_SECTIONS>/   (served)
//   <IMPORT_ROOT>/<userHome>/<IMPORT_SECTIONS>/     (drop tree)
// The import leaf dirs are world-writable so a Samba/other-uid user can drop files
// (the container runs as a different uid). Idempotent. Returns the userHome name.
export function ensureUserHome(
  userId: number,
  username?: string | null
): string {
  const home = userHomeDir(userId, username);
  for (const sec of PROFILE_SECTIONS) {
    ensureDir(path.join(PROFILE_ROOT, home, sec));
  }
  for (const sec of IMPORT_SECTIONS) {
    const dir = path.join(IMPORT_ROOT, home, sec);
    ensureDir(dir);
    makeDroppable(dir);
  }
  return home;
}
