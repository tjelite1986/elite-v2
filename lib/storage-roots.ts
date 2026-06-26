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
//   <IMPORT_ROOT>/u_<user>/{gallery,posts,shorts,shorts18,books}
export const IMPORT_ROOT =
  process.env.IMPORT_ROOT || path.join(DATA_DIR, "_import");

// Shared book library — NOT per-user. Every account reads the same shelf; only
// reading progress is per-user (in the DB). A user drops a book into their own
// _import/books folder and it is ingested into this shared root.
export const BOOKS_ROOT =
  process.env.BOOKS_ROOT || path.join(DATA_DIR, "books");

// Per-user permanent sections under PROFILE_ROOT/u_<user>/. Books is intentionally
// absent (shared library); `cookies` holds per-user service cookies (e.g. the
// Instagram session for the per-user sync).
export const PROFILE_SECTIONS = [
  "gallery",
  "posts",
  "shorts",
  "shorts18",
  "cookies",
] as const;

// Per-user drop sections under IMPORT_ROOT/u_<user>/. Books IS present here — the
// dropped file is staged per user but ingested into the shared BOOKS_ROOT.
export const IMPORT_SECTIONS = [
  "gallery",
  "posts",
  "shorts",
  "shorts18",
  "books",
] as const;
