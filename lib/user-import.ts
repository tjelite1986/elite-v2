import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "./db";
import type { ShortChannel } from "./db";
import { qb, getOne } from "./kysely";
import {
  userHomeDir,
  storeShortUpload,
  profileFromFilename,
  renameShortFiles,
} from "./shorts-storage";
import { IMPORT_ROOT } from "./storage-roots";
import {
  storePostImage,
  authorSlug,
  renamePostImageFiles,
  mediaPathFor,
  deletePostImageFiles,
} from "./posts-storage";
import { ingestMedia } from "./gallery-ingest";
import { ingestUpload } from "./books";
import { getAliasProfileId } from "./shorts";
import {
  getExt,
  isSupportedImage,
  isSupportedVideo,
  renameGalleryFiles,
} from "./gallery-storage";
import { getProfileByUserId } from "./profiles";
import { parseHashtags } from "./posts";
import {
  parseImportName,
  canonicalStem,
  type ParsedImportName,
} from "./import-naming";

// Per-user folder import. Each account owns a top-level drop tree, separate from
// its served storage:
//   <IMPORT_ROOT>/u_<user>/
//       shorts/    -> the user's own shorts on the main channel
//       shorts18/  -> the user's own shorts on the 18+ channel
//       posts/     -> the user's own photo posts
//       gallery/   -> the user's own gallery items
//       books/     -> ingested into the SHARED book library (attributed to user)
// A user groups content two ways, both yielding the same named collection:
//   1. drop files inside a SUBFOLDER  -> the folder name is the collection,
//   2. name a file  "<title> [<collection>].<ext>"  -> e.g.
//      "hoppa rep ar roligt [hoppa rep].jpg" lands in the collection "hoppa rep"
//      with the caption/title "hoppa rep ar roligt".
// The collection maps to the natural per-section grouping, always owned by the
// user: a short_playlists row for shorts and a gallery_albums row for gallery.
// Posts are NOT grouped — every image becomes its own post so the user can stack
// them into a carousel themselves afterwards; the token only supplies a caption.
// Files with no token/subfolder import loose. Imported sources are deleted on
// success so re-runs don't duplicate.

// Browser-playable video extensions are inserted 'ready'; everything else comes
// in 'pending' for the host transcoder (matches app/api/shorts/upload).
const WEB_PLAYABLE = new Set(["mp4", "m4v", "webm"]);

export interface ImportSummary {
  users: number;
  imported: number;
  skipped: number;
  details: string[];
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

// Read a "<stem>.md" caption sidecar dropped next to a file (the same convention
// the shorts importer uses: the .md holds the post/clip caption). Returns the
// trimmed caption (null if absent or empty) plus the sidecar path so the caller
// can delete it after a successful import.
function readMdSidecar(fileAbs: string): {
  caption: string | null;
  sidecar: string | null;
} {
  const [stem] = splitExt(path.basename(fileAbs));
  const sidecar = path.join(path.dirname(fileAbs), `${stem}.md`);
  if (!fs.existsSync(sidecar)) return { caption: null, sidecar: null };
  let caption: string | null = null;
  try {
    caption = fs.readFileSync(sidecar, "utf8").trim().slice(0, 2200) || null;
  } catch {
    /* unreadable — still let the caller consume it */
  }
  return { caption, sidecar };
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

// A subfolder on the 18+ channel maps to a creator profile (like the auto-poll
// creators), so the folder shows up in /shorts18/profiles. Find-or-create a
// `manual` short_profiles row. Names are stored/matched LOWERCASE so a re-import
// reuses the same profile regardless of the source folder's casing.
function findOrCreateShortProfile(name: string, channel: ShortChannel): number {
  const lname = name.toLowerCase();
  // A merged-away handle (alias) routes to the surviving profile, so re-importing
  // e.g. a "lillieinlove" folder lands on the merged "lillielucas" profile.
  const aliased = getAliasProfileId(channel, lname);
  if (aliased) return aliased;
  const row = getOne<{ id: number }>(
    qb
      .selectFrom("short_profiles")
      .select("id")
      .where("channel", "=", channel)
      .where("name", "=", lname)
  );
  if (row) return row.id;
  return Number(
    db
      .prepare(
        "INSERT INTO short_profiles (name, channel, source_type, source_ref, auto_poll, videos_limit) VALUES (?, ?, 'manual', '', 0, 20)"
      )
      .run(lname, channel).lastInsertRowid
  );
}

function findOrCreatePlaylist(userId: number, name: string): number {
  const row = getOne<{ id: number }>(
    qb
      .selectFrom("short_playlists")
      .select("id")
      .where("user_id", "=", userId)
      .where("name", "=", name)
  );
  if (row) return row.id;
  return Number(
    db
      .prepare("INSERT INTO short_playlists (user_id, name) VALUES (?, ?)")
      .run(userId, name).lastInsertRowid
  );
}

// Normalize a drop-subfolder name to a post_creator handle — same rule as the
// shared creator importer (scripts/import-posts.mjs creatorUsername) so the SAME
// folder maps to the SAME creator whether it arrives via the shared posts/_import
// or a user's u_<user>/posts/<creator>/ drop, and merges with an existing one.
function creatorHandle(name: string): string {
  const s = (name || "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, "")
    .replace(/^[._]+|[._]+$/g, "")
    .slice(0, 30);
  return s || "unknown";
}

function findOrCreatePostCreator(name: string): number {
  const username = creatorHandle(name);
  const row = getOne<{ id: number }>(
    qb.selectFrom("post_creators").select("id").where("username", "=", username)
  );
  if (row) return row.id;
  return Number(
    db
      .prepare(
        "INSERT INTO post_creators (username, display_name, source) VALUES (?, ?, 'import')"
      )
      .run(username, name).lastInsertRowid
  );
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
  table: "shorts" | "posts" | "gallery_items",
  ownerCol: "uploader_id" | "author_user_id" | "user_id",
  id: number,
  userId: number
): boolean {
  return Boolean(
    db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND ${ownerCol} = ?`).get(id, userId)
  );
}

// Shorts have no tag table, so [h_] hashtags ride along in the caption text
// (visible + searchable). Appends only the tags not already present.
function captionWithHashtags(
  base: string | null,
  hashtags: string[]
): string | null {
  if (!hashtags.length) return base;
  const present = new Set(parseHashtags(base ?? ""));
  const extra = hashtags.filter((t) => !present.has(t)).map((t) => `#${t}`);
  if (!extra.length) return base;
  return `${base ? `${base} ` : ""}${extra.join(" ")}`.trim();
}

// --- Section importers ---------------------------------------------------

async function importShortsSection(
  userId: number,
  username: string | null,
  channel: ShortChannel,
  dir: string,
  res: ImportSummary
) {
  for (const item of collectItems(dir)) {
    const ext = getExt(item.name);
    if (!isSupportedVideo(item.name, "")) continue;
    const parsed = resolve(item);
    const { title } = parsed;
    // 18+ collections become creator profiles — keep them lowercase (the convention
    // used everywhere else) so folders/profiles/files stay consistent and a re-import
    // never makes a case-variant duplicate profile.
    let collection = parsed.collection;
    // A drop subfolder / [f_] becomes a CREATOR PROFILE on BOTH channels now, so
    // normalize its name to lowercase (the convention everywhere else) so a
    // re-import never makes a case-variant duplicate profile.
    if (collection) {
      collection = collection.toLowerCase();
      parsed.collection = collection;
    }
    const md = readMdSidecar(item.abs);
    if (parsed.siteId && rowExists("shorts", "uploader_id", parsed.siteId, userId)) {
      consume(item.abs);
      if (md.sidecar) consume(md.sidecar);
      res.skipped++;
      res.details.push(`shorts/${channel} ${item.name}: already imported as #${parsed.siteId}`);
      continue;
    }
    const caption = captionWithHashtags(md.caption ?? (title || null), parsed.hashtags);
    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(item.abs);
    } catch {
      res.skipped++;
      continue;
    }
    try {
      // Subfolder precedence: an explicit collection (drop subfolder or
      // "[bracket]" token) wins; otherwise a "profilname_-_title" filename lands
      // in that creator's folder; otherwise storeShortUpload uses its shared
      // fallback dir — so an imported clip is never stored loose either.
      const subdir = collection ?? profileFromFilename(item.name) ?? undefined;
      const stored = await storeShortUpload(
        channel,
        userHomeDir(userId, username),
        title,
        item.name,
        "",
        buffer,
        subdir
      );
      const status = WEB_PLAYABLE.has(ext) ? "ready" : "pending";
      // A subfolder / [f_] becomes a CREATOR PROFILE on BOTH channels (shown in
      // /shorts and /shorts18 profiles) and its clips are PUBLIC, like the
      // auto-poll creators — so a user's drop folder named after a creator
      // aggregates that creator's clips under one handle, merged across users.
      // A loose file (no collection) stays the user's own private clip.
      const asProfile = !!collection;
      const profileId = asProfile
        ? findOrCreateShortProfile(collection as string, channel)
        : null;
      const isPrivate = asProfile ? 0 : 1;
      const shortId = Number(
        db
          .prepare(
            `INSERT INTO shorts
               (channel, profile_id, uploader_id, caption, storage_key, poster_key,
                mime_type, width, height, duration, size_bytes, source, status, is_private)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'import', ?, ?)`
          )
          .run(
            channel,
            profileId,
            userId,
            caption,
            stored.storageKey,
            stored.posterKey,
            stored.mimeType,
            stored.width,
            stored.height,
            stored.duration,
            stored.sizeBytes,
            status,
            isPrivate
          ).lastInsertRowid
      );
      if (collection && !asProfile) {
        const playlistId = findOrCreatePlaylist(userId, collection);
        db.prepare(
          "INSERT OR IGNORE INTO short_playlist_items (playlist_id, short_id) VALUES (?, ?)"
        ).run(playlistId, shortId);
      }
      // Rename to the canonical self-describing name now that we know the id.
      // 18+ stored filenames are lowercased to match the lowercase folder/profile
      // (the caption keeps its original casing).
      try {
        const stem = canonicalStem(parsed, shortId, "clip");
        const renamed = renameShortFiles(
          channel,
          stored.storageKey,
          stored.posterKey,
          asProfile ? stem.toLowerCase() : stem
        );
        db.prepare("UPDATE shorts SET storage_key = ?, poster_key = ? WHERE id = ?").run(
          renamed.storageKey,
          renamed.posterKey,
          shortId
        );
      } catch {
        /* keep the original stored name if the rename fails */
      }
      consume(item.abs);
      if (md.sidecar) consume(md.sidecar);
      res.imported++;
    } catch (err) {
      res.skipped++;
      res.details.push(`shorts/${channel} ${item.name}: ${(err as Error).message}`);
    }
  }
  pruneEmptyDirs(dir);
}

async function importPostsSection(
  userId: number,
  username: string | null,
  dir: string,
  res: ImportSummary
) {
  const userSlug = authorSlug(username ?? `u${userId}`);
  const userHome = userHomeDir(userId, username);
  const insertUserPost = db.prepare(
    "INSERT INTO posts (author_user_id, caption) VALUES (?, ?)"
  );
  const insertCreatorPost = db.prepare(
    "INSERT INTO posts (author_creator_id, caption) VALUES (?, ?)"
  );
  const insertMedia = db.prepare(
    `INSERT INTO post_media (post_id, storage_key, mime_type, width, height, position, content_hash)
     VALUES (?, ?, ?, ?, ?, 0, ?)`
  );
  const insertHashtag = db.prepare(
    "INSERT OR IGNORE INTO post_hashtags (post_id, tag) VALUES (?, ?)"
  );
  // Has this creator already got an image with this exact content? Per-creator
  // dedup mirroring scripts/import-posts.mjs, so re-dropping a creator's images —
  // or overlapping drops from several users — never duplicates.
  const creatorHashSeen = db.prepare(
    `SELECT 1 FROM post_media pm JOIN posts p ON p.id = pm.post_id
      WHERE p.author_creator_id = ? AND pm.content_hash = ? LIMIT 1`
  );

  // One post per image — never auto-stack into carousels. A DROP SUBFOLDER names a
  // CREATOR: the image becomes that creator's public post (find-or-create by
  // handle, merged across users), so a user's u_<user>/posts/<creator>/ folder
  // aggregates under one /people profile (like @sophieraiin). A LOOSE file stays
  // the user's own post. Caption: a "<stem>.md" sidecar, else the [token] title.
  for (const item of collectItems(dir)) {
    if (!isSupportedImage(item.name, "")) continue;
    const [stem] = splitExt(item.name);
    const parsed = parseImportName(stem);
    const md = readMdSidecar(item.abs);
    const asCreator = !!item.collection;
    // [id_] re-import dedup only applies to a user's OWN posts; creator posts use
    // the content-hash dedup below (their id namespace isn't the user's).
    if (
      !asCreator &&
      parsed.siteId &&
      rowExists("posts", "author_user_id", parsed.siteId, userId)
    ) {
      consume(item.abs);
      if (md.sidecar) consume(md.sidecar);
      res.skipped++;
      res.details.push(`posts ${item.name}: already imported as #${parsed.siteId}`);
      continue;
    }
    const caption = md.caption ?? (parsed.collection ? parsed.title || null : null);
    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(item.abs);
    } catch {
      res.skipped++;
      continue;
    }
    try {
      const creatorId = asCreator
        ? findOrCreatePostCreator(item.collection as string)
        : null;
      // Creator posts live under the shared POSTS_ROOT/<creator>/ layout (userHome
      // omitted); a user's own posts live under PROFILE_ROOT/u_<user>/posts/.
      const storeSlug = asCreator
        ? authorSlug(creatorHandle(item.collection as string))
        : userSlug;
      const stored = await storePostImage(
        storeSlug,
        item.name,
        "",
        buffer,
        asCreator ? null : userHome
      );
      let contentHash: string | null = null;
      if (asCreator && creatorId) {
        try {
          contentHash = crypto
            .createHash("sha256")
            .update(fs.readFileSync(mediaPathFor(stored.storageKey)))
            .digest("hex");
        } catch {
          /* unreadable just-written file — skip dedup, still import */
        }
        if (contentHash && creatorHashSeen.get(creatorId, contentHash)) {
          deletePostImageFiles(stored.storageKey);
          consume(item.abs);
          if (md.sidecar) consume(md.sidecar);
          res.skipped++;
          continue; // already on this creator
        }
      }
      const postId = Number(
        (asCreator
          ? insertCreatorPost.run(creatorId, caption)
          : insertUserPost.run(userId, caption)
        ).lastInsertRowid
      );
      // Rename to a site-relevant self-describing name now that we know the id.
      let mediaKey = stored.storageKey;
      try {
        mediaKey = renamePostImageFiles(stored.storageKey, canonicalStem(parsed, postId, "post"));
      } catch {
        /* keep the original stored name if the rename fails */
      }
      insertMedia.run(postId, mediaKey, "image/jpeg", stored.width, stored.height, contentHash);
      // Hashtags from the caption AND the filename's [h_] tokens.
      const tags = new Set<string>(parsed.hashtags);
      if (caption) for (const t of parseHashtags(caption)) tags.add(t);
      for (const tag of Array.from(tags)) insertHashtag.run(postId, tag);
      consume(item.abs);
      if (md.sidecar) consume(md.sidecar);
      res.imported++;
    } catch (err) {
      res.skipped++;
      res.details.push(`posts ${item.name}: ${(err as Error).message}`);
    }
  }
  pruneEmptyDirs(dir);
}

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
    let buffer: Buffer;
    let mtimeMs: number | null = null;
    try {
      buffer = fs.readFileSync(item.abs);
      mtimeMs = fs.statSync(item.abs).mtimeMs;
    } catch {
      res.skipped++;
      continue;
    }
    try {
      const id = await ingestMedia(userId, storeName, "", buffer, mtimeMs);
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
      consume(item.abs);
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
      buffer = fs.readFileSync(item.abs);
    } catch {
      res.skipped++;
      continue;
    }
    try {
      await ingestUpload({ buffer, filename: item.name, title, addedBy: userId });
      consume(item.abs);
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

// Walk every user's _import tree and import each section. Pass onlyUser (a home
// folder name or username) to limit the run to one account.
export async function runUserFolderImport(opts?: {
  onlyUser?: string;
}): Promise<ImportSummary> {
  const res: ImportSummary = { users: 0, imported: 0, skipped: 0, details: [] };
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

    await importShortsSection(
      user.userId,
      user.username,
      "main",
      path.join(base, "shorts"),
      res
    );
    await importShortsSection(
      user.userId,
      user.username,
      "18plus",
      path.join(base, "shorts18"),
      res
    );
    await importPostsSection(user.userId, user.username, path.join(base, "posts"), res);
    await importGallerySection(user.userId, path.join(base, "gallery"), res);
    await importBooksSection(user.userId, path.join(base, "books"), res);
  }

  return res;
}
