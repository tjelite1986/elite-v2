import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { db } from "./db";
import { qb, getOne } from "./kysely";
import { IMPORT_ROOT } from "./storage-roots";
import { ingestMedia } from "./gallery-ingest";
import { ingestUpload } from "./books";
import {
  getExt,
  isSupportedImage,
  isSupportedVideo,
  renameGalleryFiles,
} from "./gallery-storage";
import { getProfileByUserId } from "./profiles";
import {
  parseImportName,
  canonicalStem,
  type ParsedImportName,
} from "./import-naming";

// Per-user folder import. Each account owns a top-level drop tree, separate from
// its served storage:
//   <IMPORT_ROOT>/u_<user>/
//       gallery/   -> the user's own gallery items
//         (neither a posts nor a shorts folder is read: all three libraries
//          moved out — main shorts 2026-08-31, 18+ shorts 2026-09-15, posts
//          2026-09-16 — and each of those apps has a drop folder of its own)
//       books/     -> ingested into the SHARED book library (attributed to user)
// A user groups content two ways, both yielding the same named collection:
//   1. drop files inside a SUBFOLDER  -> the folder name is the collection,
//   2. name a file  "<title> [<collection>].<ext>"  -> e.g.
//      "hoppa rep ar roligt [hoppa rep].jpg" lands in the collection "hoppa rep"
//      with the caption/title "hoppa rep ar roligt".
// A collection maps to a private gallery_albums row owned by the user. Files
// with no token/subfolder import loose as the user's own private content.
// Imported sources are deleted on success so re-runs don't duplicate.

export interface ImportSummary {
  users: number;
  imported: number;
  skipped: number;
  details: string[];
  // Set when a run was refused because another one was already sweeping the
  // same drop tree.
  alreadyRunning?: boolean;
}

interface DropItem {
  abs: string;
  name: string;
  collection: string | null; // set when the file came from a subfolder
}

// parseImportName / canonicalStem / ParsedImportName now live in ./import-naming
// (shared with the interactive upload routes).

// Split a filename into [stem, dotExt], treating ".web.mp4" as one extension so
// already-transcoded clips keep their readable stem.
function splitExt(name: string): [string, string] {
  if (name.toLowerCase().endsWith(".web.mp4")) {
    return [name.slice(0, -".web.mp4".length), ".web.mp4"];
  }
  const ext = path.extname(name);
  return [name.slice(0, name.length - ext.length), ext];
}

// Collect importable files in a section: loose top-level files (collection from
// the filename token) plus one level of subfolders (collection = folder name).
function collectItems(sectionDir: string): DropItem[] {
  const out: DropItem[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(sectionDir, { withFileTypes: true });
  } catch {
    return out; // section folder missing -> nothing to do
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const abs = path.join(sectionDir, e.name);
    if (e.isFile()) {
      out.push({ abs, name: e.name, collection: null });
    } else if (e.isDirectory()) {
      let inner: fs.Dirent[];
      try {
        inner = fs.readdirSync(abs, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const f of inner) {
        if (f.name.startsWith(".") || !f.isFile()) continue;
        out.push({ abs: path.join(abs, f.name), name: f.name, collection: e.name });
      }
    }
  }
  return out;
}

// Resolve a file's metadata: a drop subfolder always wins as the collection;
// otherwise collection/title/hashtags/id come from the filename's [bracket] tokens.
function resolve(item: DropItem): ParsedImportName {
  const [stem] = splitExt(item.name);
  const parsed = parseImportName(stem);
  return { ...parsed, collection: item.collection ?? parsed.collection };
}

// Delete a consumed source. Returns false if the container can't unlink it (e.g.
// a directory it doesn't own) so the caller leaves it for a later retry.
function consume(abs: string): boolean {
  try {
    fs.unlinkSync(abs);
    return true;
  } catch {
    return false;
  }
}

// Consume an imported source; if the unlink fails, rename the source in place to
// carry the [id_<id>] token so the round-trip dedup skips it on every future run
// instead of re-importing it forever. Logs into the summary when neither works.
function consumeImported(
  abs: string,
  parsed: ParsedImportName,
  id: number,
  kind: "clip" | "post" | undefined,
  section: string,
  res: ImportSummary
): void {
  if (consume(abs)) return;
  try {
    const [, ext] = splitExt(path.basename(abs));
    const marked = path.join(
      path.dirname(abs),
      `${canonicalStem(parsed, id, kind)}${ext}`
    );
    if (marked !== abs) {
      fs.renameSync(abs, marked);
      return;
    }
  } catch {
    /* can't rename either */
  }
  res.details.push(
    `${section} ${path.basename(abs)}: imported as #${id} but the source could not be deleted — fix the drop folder permissions or it may re-import`
  );
}

// Remove now-empty collection subfolders so the drop tree stays tidy (the four
// section roots themselves are left in place). Best effort.
function pruneEmptyDirs(sectionDir: string) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(sectionDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(sectionDir, e.name);
    try {
      if (fs.readdirSync(dir).filter((n) => !n.startsWith(".")).length === 0) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      /* best effort */
    }
  }
}

function findOrCreateAlbum(userId: number, name: string): number {
  const row = getOne<{ id: number }>(
    qb
      .selectFrom("gallery_albums")
      .select("id")
      .where("user_id", "=", userId)
      .where("name", "=", name)
  );
  if (row) return row.id;
  return Number(
    db
      .prepare("INSERT INTO gallery_albums (user_id, name) VALUES (?, ?)")
      .run(userId, name).lastInsertRowid
  );
}

// Re-import dedup: a stored file's name carries [id_<id>]. If that owned row
// still exists the dropped file is a redundant copy of content already in the
// library, so the caller skips it. (Numeric id only — books dedup by slug.)
function rowExists(
  table: "gallery_items",
  ownerCol: "user_id",
  id: number,
  userId: number
): boolean {
  return Boolean(
    db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND ${ownerCol} = ?`).get(id, userId)
  );
}

// --- Section importers ---------------------------------------------------

async function importGallerySection(
  userId: number,
  dir: string,
  res: ImportSummary
) {
  for (const item of collectItems(dir)) {
    if (!isSupportedImage(item.name, "") && !isSupportedVideo(item.name, "")) continue;
    const parsed = resolve(item);
    const { title, collection } = parsed;
    if (parsed.siteId && rowExists("gallery_items", "user_id", parsed.siteId, userId)) {
      consume(item.abs);
      res.skipped++;
      res.details.push(`gallery ${item.name}: already imported as #${parsed.siteId}`);
      continue;
    }
    const [, ext] = splitExt(item.name);
    // Store under a clean name (drop the [collection] token) but keep the title.
    const storeName = `${title || "media"}${ext}`;
    let mtimeMs: number | null = null;
    try {
      mtimeMs = fs.statSync(item.abs).mtimeMs;
    } catch {
      res.skipped++;
      continue;
    }
    try {
      // Pass the source PATH — videos are copied instead of buffered in memory.
      const id = await ingestMedia(userId, storeName, "", item.abs, mtimeMs);
      if (!id) {
        res.skipped++;
        continue;
      }
      if (collection) {
        const albumId = findOrCreateAlbum(userId, collection);
        db.prepare(
          "INSERT OR IGNORE INTO gallery_album_items (album_id, item_id) VALUES (?, ?)"
        ).run(albumId, id);
      }
      // Rename the uuid file to the canonical self-describing name (keeps yyyy/mm).
      try {
        const cur = getOne<{ storage_key: string }>(
          qb.selectFrom("gallery_items").select("storage_key").where("id", "=", id)
        );
        if (cur) {
          const newKey = renameGalleryFiles(userId, cur.storage_key, canonicalStem(parsed, id));
          db.prepare("UPDATE gallery_items SET storage_key = ? WHERE id = ?").run(newKey, id);
        }
      } catch {
        /* keep the original stored name if the rename fails */
      }
      // Hashtags from the filename's [h_] tokens -> gallery_tags (owned item).
      if (parsed.hashtags.length) {
        const insTag = db.prepare(
          "INSERT OR IGNORE INTO gallery_tags (item_id, tag) VALUES (?, ?)"
        );
        for (const t of parsed.hashtags) insTag.run(id, t);
      }
      consumeImported(item.abs, parsed, id, undefined, "gallery", res);
      res.imported++;
    } catch (err) {
      res.skipped++;
      res.details.push(`gallery ${item.name}: ${(err as Error).message}`);
    }
  }
  pruneEmptyDirs(dir);
}

const BOOK_EXTS = new Set(["epub", "pdf", "cbz", "zip"]);
function isSupportedBook(name: string): boolean {
  return BOOK_EXTS.has(getExt(name));
}
function bookTitleExists(title: string): boolean {
  // Normalize (case/trim) so a re-drop with trivial title differences still dedups.
  return Boolean(
    db
      .prepare("SELECT 1 FROM books WHERE trim(lower(title)) = trim(lower(?))")
      .get(title)
  );
}

// Books are a SHARED library (not per-user): a dropped book is ingested into the
// common BOOKS_ROOT via lib/books.ingestUpload (slug-keyed name + cover), only
// attributed to the dropping user (added_by). Dedup is by title (the slug PK),
// not by [id_] — books have no numeric id.
async function importBooksSection(
  userId: number,
  dir: string,
  res: ImportSummary
) {
  for (const item of collectItems(dir)) {
    if (!isSupportedBook(item.name)) continue;
    const [stem] = splitExt(item.name);
    const title = parseImportName(stem).title || stem;
    if (bookTitleExists(title)) {
      consume(item.abs);
      res.skipped++;
      res.details.push(`books ${item.name}: already in library ("${title}")`);
      continue;
    }
    let buffer: Buffer;
    try {
      buffer = await fsp.readFile(item.abs);
    } catch {
      res.skipped++;
      continue;
    }
    try {
      await ingestUpload({ buffer, filename: item.name, title, addedBy: userId });
      if (!consume(item.abs)) {
        // Title-based dedup will skip it next run, but surface the stuck file.
        res.details.push(
          `books ${item.name}: imported but the source could not be deleted — fix the drop folder permissions`
        );
      }
      res.imported++;
    } catch (err) {
      res.skipped++;
      res.details.push(`books ${item.name}: ${(err as Error).message}`);
    }
  }
  pruneEmptyDirs(dir);
}

// Map an "u_<user>" home folder back to an account: by username first (the slug
// equals the username, which is constrained to [a-z0-9._]), else by numeric id.
function resolveUser(home: string): { userId: number; username: string | null } | null {
  if (!home.startsWith("u_")) return null;
  const tail = home.slice(2);
  const byName = getOne<{ user_id: number; username: string }>(
    qb
      .selectFrom("user_profiles")
      .select(["user_id", "username"])
      .where("username", "=", tail)
  );
  if (byName) return { userId: byName.user_id, username: byName.username };
  if (/^\d+$/.test(tail)) {
    const id = Number(tail);
    const exists = getOne<{ id: number }>(
      qb.selectFrom("users").select("id").where("id", "=", id)
    );
    if (!exists) return null;
    return { userId: id, username: getProfileByUserId(id)?.username ?? null };
  }
  return null;
}

// Concurrency lock: two overlapping runs (admin button + cron secret, or a
// double-click) would both list the same drop files before either consumes
// them, importing everything twice. Single process (custom server), so a
// module-level promise is enough — same pattern as statusRefreshing in
// lib/instagram.ts.
let importInFlight: Promise<ImportSummary> | null = null;

// Walk every user's _import tree and import each section. Pass onlyUser (a home
// folder name or username) to limit the run to one account.
export async function runUserFolderImport(opts?: {
  onlyUser?: string;
}): Promise<ImportSummary> {
  if (importInFlight) {
    return {
      users: 0,
      imported: 0,
      skipped: 0,
      details: ["Another user-folder import is already running."],
      alreadyRunning: true,
    };
  }
  const run = runUserFolderImportInner(opts);
  importInFlight = run;
  try {
    return await run;
  } finally {
    importInFlight = null;
  }
}

async function runUserFolderImportInner(opts?: {
  onlyUser?: string;
}): Promise<ImportSummary> {
  const res: ImportSummary = {
    users: 0,
    imported: 0,
    skipped: 0,
    details: [],
  };
  let homes: string[];
  try {
    homes = fs
      .readdirSync(IMPORT_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith("u_"))
      .map((e) => e.name);
  } catch {
    return res;
  }

  for (const home of homes) {
    const user = resolveUser(home);
    if (!user) continue;
    if (
      opts?.onlyUser &&
      opts.onlyUser !== home &&
      opts.onlyUser !== user.username
    ) {
      continue;
    }
    const base = path.join(IMPORT_ROOT, home);
    if (!fs.existsSync(base)) continue;
    res.users++;

    // Neither shorts section is imported any more, and neither is posts — all
    // three libraries are separate apps now. A file dropped in an old folder is
    // left alone rather than imported into a section this app no longer serves;
    // the folders themselves are left on disk, since deleting someone's drop is
    // not this job's call.
    await importGallerySection(user.userId, path.join(base, "gallery"), res);
    await importBooksSection(user.userId, path.join(base, "books"), res);
  }

  return res;
}
