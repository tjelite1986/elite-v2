import fs from "node:fs";
import path from "node:path";
import { db } from "./db";
import type { ShortChannel } from "./db";
import { qb, getOne } from "./kysely";
import { PROFILE_ROOT, userHomeDir, storeShortUpload } from "./shorts-storage";
import { storePostImage, authorSlug } from "./posts-storage";
import { ingestMedia } from "./gallery-ingest";
import { getExt, isSupportedImage, isSupportedVideo } from "./gallery-storage";
import { getProfileByUserId } from "./profiles";
import { parseHashtags } from "./posts";

// Per-user folder import. Each account owns a drop tree under its home:
//   <PROFILE_ROOT>/u_<user>/_import/
//       shorts/main/      -> the user's own shorts on the main channel
//       shorts/18plus/    -> the user's own shorts on the 18+ channel
//       posts/            -> the user's own photo posts
//       gallery/          -> the user's own gallery items
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

// "title [collection].ext" stem -> { title, collection }. The bracket is the
// collection; everything before it is the title. No bracket -> whole stem is the
// title and the file imports loose (collection null).
export function parseTitleCollection(stem: string): {
  title: string;
  collection: string | null;
} {
  const m = stem.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
  if (m) {
    const collection = m[2].trim() || null;
    return { title: m[1].trim() || collection || "", collection };
  }
  return { title: stem.trim(), collection: null };
}

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

// Resolve a file's collection + title: a subfolder name always wins as the
// collection; otherwise it comes from the filename's [bracket] token.
function resolve(item: DropItem): { title: string; collection: string | null } {
  const [stem] = splitExt(item.name);
  const parsed = parseTitleCollection(stem);
  return {
    title: parsed.title,
    collection: item.collection ?? parsed.collection,
  };
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
    const { title, collection } = resolve(item);
    const md = readMdSidecar(item.abs);
    const caption = md.caption ?? (title || null);
    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(item.abs);
    } catch {
      res.skipped++;
      continue;
    }
    try {
      const stored = await storeShortUpload(
        channel,
        userHomeDir(userId, username),
        title,
        item.name,
        "",
        buffer,
        collection
      );
      const status = WEB_PLAYABLE.has(ext) ? "ready" : "pending";
      const shortId = Number(
        db
          .prepare(
            `INSERT INTO shorts
               (channel, uploader_id, caption, storage_key, poster_key, mime_type,
                width, height, duration, size_bytes, source, status, is_private)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'import', ?, 1)`
          )
          .run(
            channel,
            userId,
            caption,
            stored.storageKey,
            stored.posterKey,
            stored.mimeType,
            stored.width,
            stored.height,
            stored.duration,
            stored.sizeBytes,
            status
          ).lastInsertRowid
      );
      if (collection) {
        const playlistId = findOrCreatePlaylist(userId, collection);
        db.prepare(
          "INSERT OR IGNORE INTO short_playlist_items (playlist_id, short_id) VALUES (?, ?)"
        ).run(playlistId, shortId);
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
  const slug = authorSlug(username ?? `u${userId}`);
  const userHome = userHomeDir(userId, username);
  const insertPost = db.prepare(
    "INSERT INTO posts (author_user_id, caption) VALUES (?, ?)"
  );
  const insertMedia = db.prepare(
    `INSERT INTO post_media (post_id, storage_key, mime_type, width, height, position)
     VALUES (?, ?, ?, ?, ?, 0)`
  );
  const insertHashtag = db.prepare(
    "INSERT OR IGNORE INTO post_hashtags (post_id, tag) VALUES (?, ?)"
  );

  // One post per image — never auto-stack into carousels. Caption precedence:
  // a "<stem>.md" sidecar, else the filename's [token] title; a plain filename
  // or a subfolder name isn't treated as a caption.
  for (const item of collectItems(dir)) {
    if (!isSupportedImage(item.name, "")) continue;
    const [stem] = splitExt(item.name);
    const parsed = parseTitleCollection(stem);
    const md = readMdSidecar(item.abs);
    const caption = md.caption ?? (parsed.collection ? parsed.title || null : null);
    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(item.abs);
    } catch {
      res.skipped++;
      continue;
    }
    try {
      const stored = await storePostImage(slug, item.name, "", buffer, userHome);
      const postId = Number(insertPost.run(userId, caption).lastInsertRowid);
      insertMedia.run(
        postId,
        stored.storageKey,
        "image/jpeg",
        stored.width,
        stored.height
      );
      if (caption) {
        for (const tag of parseHashtags(caption)) insertHashtag.run(postId, tag);
      }
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
    const { title, collection } = resolve(item);
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
      consume(item.abs);
      res.imported++;
    } catch (err) {
      res.skipped++;
      res.details.push(`gallery ${item.name}: ${(err as Error).message}`);
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
      .readdirSync(PROFILE_ROOT, { withFileTypes: true })
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
    const base = path.join(PROFILE_ROOT, home, "_import");
    if (!fs.existsSync(base)) continue;
    res.users++;

    await importShortsSection(
      user.userId,
      user.username,
      "main",
      path.join(base, "shorts", "main"),
      res
    );
    await importShortsSection(
      user.userId,
      user.username,
      "18plus",
      path.join(base, "shorts", "18plus"),
      res
    );
    await importPostsSection(user.userId, user.username, path.join(base, "posts"), res);
    await importGallerySection(user.userId, path.join(base, "gallery"), res);
  }

  return res;
}
