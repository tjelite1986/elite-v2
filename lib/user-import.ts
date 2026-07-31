import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "./db";
import type { ShortChannel, ImportReviewRow } from "./db";
import { qb, getOne, getAll } from "./kysely";
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
  moveFile,
  POSTS_ROOT,
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
import { SOURCE_RE } from "./shorts-caption";
import {
  parseImportName,
  canonicalStem,
  type ParsedImportName,
} from "./import-naming";
import {
  ssim,
  hamming,
  HASH_TOL,
  SSIM_CONFIRM,
  meanSaturation,
  sameColourMode,
} from "@/scripts/lib/image-dupe.mjs";
import {
  fingerprintOffThread,
  signatureOffThread,
  type Fingerprint,
} from "./hash-offload";

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
// What a collection maps to differs per section: for shorts/shorts18 it names a
// CREATOR PROFILE (public, merged across users — like the auto-poll creators);
// for gallery it is a private gallery_albums row owned by the user; for posts a
// subfolder names a creator (public post) while a token only supplies a caption.
// Files with no token/subfolder import loose as the user's own private content.
// Imported sources are deleted on success so re-runs don't duplicate.

// Browser-playable video extensions are inserted 'ready'; everything else comes
// in 'pending' for the host transcoder (matches app/api/shorts/upload).
const WEB_PLAYABLE = new Set(["mp4", "m4v", "webm"]);

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

const CAPTION_LIMIT = 2200;

// Read a caption sidecar dropped next to a file. Two formats are accepted:
//
//   <stem>.md    plain text, the convention the shorts importer uses
//   <stem>.json  the piko Instagram patch's post metadata, whose "caption" field
//                is the original post text (the rest of the object — username,
//                shortcode, post_url, mentions — is not consumed here)
//
// A .md wins when both exist: it is hand-written, so it is the deliberate one.
// Returns the trimmed caption (null if absent or empty) plus the sidecar path so
// the caller can delete it after a successful import.
function readCaptionSidecar(fileAbs: string): {
  caption: string | null;
  sidecar: string | null;
} {
  const [stem] = splitExt(path.basename(fileAbs));
  const dir = path.dirname(fileAbs);

  const md = path.join(dir, `${stem}.md`);
  if (fs.existsSync(md)) {
    let caption: string | null = null;
    try {
      caption = fs.readFileSync(md, "utf8").trim().slice(0, CAPTION_LIMIT) || null;
    } catch {
      /* unreadable — still let the caller consume it */
    }
    return { caption, sidecar: md };
  }

  const json = path.join(dir, `${stem}.json`);
  if (fs.existsSync(json)) {
    let caption: string | null = null;
    try {
      const parsed = JSON.parse(fs.readFileSync(json, "utf8"));
      if (typeof parsed?.caption === "string") {
        caption = parsed.caption.trim().slice(0, CAPTION_LIMIT) || null;
      }
      // Append the permalink as the "Source: <url>" row of the caption grammar.
      // The text above it is left exactly as posted — running it through
      // buildCaption would collapse the original line breaks — and SOURCE_RE
      // matches anywhere, so splitCaption still finds it.
      const source =
        typeof parsed?.post_url === "string" ? parsed.post_url.trim() : "";
      if (source && !SOURCE_RE.test(caption ?? "")) {
        caption = caption ? `${caption}\n\nSource: ${source}` : `Source: ${source}`;
      }
    } catch {
      /* unreadable or not the expected shape — consume it anyway */
    }
    return { caption, sidecar: json };
  }

  return { caption: null, sidecar: null };
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

// Perceptual near-duplicate check against a creator's existing images: dHash
// (from the scanner's post_media_fp cache) proposes candidates, SSIM on the
// decoded pixels confirms. Catches the same picture at another resolution or
// re-compression (e.g. an Instagram-synced 1080px copy vs a Facebook download
// of the same photo), which the exact content-hash check cannot see.
async function findNearDuplicate(
  creatorId: number,
  fp: { hash: bigint; gray: number },
  newFileAbs: string
): Promise<{ postId: number } | null> {
  const rows = getAll<{ post_id: number; sig: string; storage_key: string }>(
    qb
      .selectFrom("post_media_fp as f")
      .innerJoin("post_media as pm", "pm.id", "f.media_id")
      .innerJoin("posts as p", "p.id", "pm.post_id")
      .select(["pm.post_id", "f.sig", "pm.storage_key"])
      .where("p.author_creator_id", "=", creatorId)
      .where("f.sig", "is not", null)
  );
  let newSig: Uint8Array | null | undefined;
  let newSat: number | null | undefined;
  for (const row of rows) {
    let candidate: bigint;
    let candidateGray: number | undefined;
    try {
      const parsed = JSON.parse(row.sig) as { d?: string; g?: number };
      if (!parsed?.d) continue;
      candidate = BigInt(`0x${parsed.d}`);
      if (parsed.g !== undefined) candidateGray = parsed.g ? 1 : 0;
    } catch {
      continue;
    }
    // A black & white edit of a colour photo is a DIFFERENT image the user
    // wants both of — but neither stage can see that: the dHash is built from
    // luminance and SSIM compares grayscale renders, so the pair scores ~1.0.
    // The colour/grayscale flag is the only signal that separates them, and the
    // batch scanners already skip mismatched pairs; do the same here.
    if (candidateGray !== undefined && candidateGray !== fp.gray) continue;
    if (hamming(fp.hash, candidate) > HASH_TOL) continue;
    // Candidate — confirm on actual pixels (the whole point: dHash alone
    // would also park similar-but-different shots from the same shoot).
    if (newSig === undefined) newSig = await signatureOffThread(newFileAbs);
    if (!newSig) return null; // undecodable new file — let it import
    const oldAbs = mediaPathFor(row.storage_key);
    const oldSig = await signatureOffThread(oldAbs);
    if (oldSig && ssim(newSig, oldSig) >= SSIM_CONFIRM) {
      // Final colour-mode check on the ACTUAL pixels. The cached g flag above
      // is a coarse bucket (GRAY_SAT): a muted colour edit lands in the same
      // bucket as a true black & white one, so only the raw saturation tells
      // the two apart — and they are images the user wants BOTH of.
      if (newSat === undefined) newSat = await meanSaturation(newFileAbs);
      if (!sameColourMode(newSat, await meanSaturation(oldAbs))) continue;
      return { postId: row.post_id };
    }
  }
  return null;
}

// Streamed sha256 — bulk drops hash many multi-MB files; reading them into a
// Buffer and hashing synchronously would stall the single server event loop.
function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

// Cache a freshly imported image's fingerprint in the scanner's table (same
// sig format as scripts/scan-posts-duplicates.mjs) so later files in the same
// drop batch — and the next scanner run — compare against it without a rescan.
function cacheMediaFingerprint(
  mediaId: number,
  fileAbs: string,
  sha: string | null,
  fp: { hash: bigint; gray: number } | null
): void {
  try {
    const size = fs.statSync(fileAbs).size;
    const sig = fp
      ? JSON.stringify({ d: fp.hash.toString(16), g: fp.gray })
      : null;
    db.prepare(
      `INSERT INTO post_media_fp (media_id, size_bytes, sha, sig, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(media_id) DO UPDATE SET
         size_bytes = excluded.size_bytes, sha = excluded.sha,
         sig = excluded.sig, updated_at = excluded.updated_at`
    ).run(mediaId, size, sha, sig);
  } catch {
    /* cache only — the scanner recomputes on demand */
  }
}

// Park a duplicate drop file under IMPORT_ROOT/_review/ instead of deleting it,
// so the importer can compare it against the matched post in Settings and
// decide (import anyway / discard). The caption sidecar moves along with it.
function holdForReview(
  userId: number,
  item: DropItem,
  sidecarAbs: string | null,
  caption: string | null,
  collection: string,
  matchedPostId: number,
  matchType: "exact" | "similar",
  res: ImportSummary
): void {
  const reason =
    matchType === "exact"
      ? `exact duplicate of post #${matchedPostId}`
      : `looks like post #${matchedPostId} (same image, other resolution?)`;
  try {
    const relDir = path.join("_review", `u_${userId}`);
    const dir = path.join(IMPORT_ROOT, relDir);
    fs.mkdirSync(dir, { recursive: true });
    const [stem, ext] = splitExt(item.name);
    let name = item.name;
    let n = 1;
    while (fs.existsSync(path.join(dir, name))) name = `${stem} (${++n})${ext}`;
    fs.renameSync(item.abs, path.join(dir, name));
    if (sidecarAbs) {
      // Write the resolved caption rather than moving the sidecar as-is: the
      // review path reads the parked "<stem>.md" as plain text, so a .json
      // sidecar renamed to .md would surface raw JSON as the caption.
      try {
        if (caption) {
          fs.writeFileSync(path.join(dir, `${splitExt(name)[0]}.md`), caption, "utf8");
        }
        consume(sidecarAbs);
      } catch {
        /* the caption sidecar is best-effort */
      }
    }
    db.prepare(
      `INSERT INTO import_review (user_id, kind, file_rel, original_name, collection, matched_post_id, match_type)
       VALUES (?, 'posts', ?, ?, ?, ?, ?)`
    ).run(
      userId,
      path.join(relDir, name),
      item.name,
      collection,
      matchedPostId,
      matchType
    );
    res.skipped++;
    res.details.push(
      `posts ${item.name}: ${reason} on ${collection} — held for review`
    );
  } catch (err) {
    // Fall back to consuming the source rather than leaving it to re-collide
    // on every scan.
    consume(item.abs);
    if (sidecarAbs) consume(sidecarAbs);
    res.skipped++;
    res.details.push(
      `posts ${item.name}: ${reason} on ${collection} (review park failed: ${(err as Error).message})`
    );
  }
}

// Resolve a parked duplicate: 'import' stores it as a post on the same creator
// despite the content match (the dedup was wrong or the copy is wanted);
// 'discard' deletes the parked file. Both remove the review row + sidecar.
export async function decideImportReview(
  reviewId: number,
  requester: { userId: number; isAdmin: boolean },
  action: "import" | "discard"
): Promise<{ ok: true; postId?: number } | { ok: false; error: string }> {
  let q = qb.selectFrom("import_review").selectAll().where("id", "=", reviewId);
  if (!requester.isAdmin) q = q.where("user_id", "=", requester.userId);
  const row = getOne<ImportReviewRow>(q);
  if (!row) return { ok: false, error: "Review item not found." };

  const abs = path.join(IMPORT_ROOT, row.file_rel);
  const sidecar = path.join(
    path.dirname(abs),
    `${splitExt(path.basename(abs))[0]}.md`
  );
  const dropRow = () =>
    db.prepare("DELETE FROM import_review WHERE id = ?").run(row.id);

  if (action === "discard") {
    consume(abs);
    consume(sidecar);
    dropRow();
    return { ok: true };
  }

  let buffer: Buffer;
  try {
    buffer = await fsp.readFile(abs);
  } catch {
    dropRow(); // the parked file is gone — nothing left to decide about
    return { ok: false, error: "The parked file no longer exists." };
  }

  const collection = row.collection || "";
  const creatorId = findOrCreatePostCreator(collection);
  const [stem] = splitExt(row.original_name);
  const parsed = parseImportName(stem);
  let caption: string | null = null;
  try {
    caption = fs.readFileSync(sidecar, "utf8").trim() || null;
  } catch {
    /* no sidecar */
  }
  if (!caption) caption = parsed.collection ? parsed.title || null : null;

  const stored = await storePostImage(
    authorSlug(creatorHandle(collection)),
    row.original_name,
    "",
    buffer,
    null
  );
  let contentHash: string | null = null;
  try {
    contentHash = await sha256File(mediaPathFor(stored.storageKey));
  } catch {
    /* unreadable just-written file — import without a hash */
  }
  const tags = new Set<string>(parsed.hashtags);
  if (caption) for (const t of parseHashtags(caption)) tags.add(t);
  const { postId, mediaId } = db.transaction(() => {
    const pid = Number(
      db
        .prepare("INSERT INTO posts (author_creator_id, caption) VALUES (?, ?)")
        .run(creatorId, caption).lastInsertRowid
    );
    const mid = Number(
      db
        .prepare(
          `INSERT INTO post_media (post_id, storage_key, mime_type, width, height, position, content_hash)
           VALUES (?, ?, 'image/jpeg', ?, ?, 0, ?)`
        )
        .run(pid, stored.storageKey, stored.width, stored.height, contentHash)
        .lastInsertRowid
    );
    for (const tag of Array.from(tags)) {
      db.prepare(
        "INSERT OR IGNORE INTO post_hashtags (post_id, tag) VALUES (?, ?)"
      ).run(pid, tag);
    }
    return { postId: pid, mediaId: mid };
  })();
  let finalKey = stored.storageKey;
  try {
    const mediaKey = renamePostImageFiles(
      stored.storageKey,
      canonicalStem(parsed, postId, "post")
    );
    db.prepare("UPDATE post_media SET storage_key = ? WHERE post_id = ?").run(
      mediaKey,
      postId
    );
    finalKey = mediaKey;
  } catch {
    /* keep the original stored name if the rename fails */
  }
  cacheMediaFingerprint(
    mediaId,
    mediaPathFor(finalKey),
    contentHash,
    await fingerprintOffThread(mediaPathFor(finalKey))
  );
  consume(abs);
  consume(sidecar);
  dropRow();
  return { ok: true, postId };
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
export function findOrCreateShortProfile(name: string, channel: ShortChannel): number {
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
    const md = readCaptionSidecar(item.abs);
    if (parsed.siteId && rowExists("shorts", "uploader_id", parsed.siteId, userId)) {
      consume(item.abs);
      if (md.sidecar) consume(md.sidecar);
      res.skipped++;
      res.details.push(`shorts/${channel} ${item.name}: already imported as #${parsed.siteId}`);
      continue;
    }
    const caption = captionWithHashtags(md.caption ?? (title || null), parsed.hashtags);
    try {
      // Subfolder precedence: an explicit collection (drop subfolder or
      // "[bracket]" token) wins; otherwise a "profilname_-_title" filename lands
      // in that creator's folder; otherwise storeShortUpload uses its shared
      // fallback dir — so an imported clip is never stored loose either.
      // The source is passed as a PATH so multi-GB videos are copied, not
      // buffered through the Next process.
      const subdir = collection ?? profileFromFilename(item.name) ?? undefined;
      const stored = await storeShortUpload(
        channel,
        userHomeDir(userId, username),
        title,
        item.name,
        "",
        item.abs,
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
      consumeImported(item.abs, parsed, shortId, "clip", `shorts/${channel}`, res);
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
    `SELECT p.id FROM post_media pm JOIN posts p ON p.id = pm.post_id
      WHERE p.author_creator_id = ? AND pm.content_hash = ? LIMIT 1`
  );

  // One post per image — never auto-stack into carousels. A DROP SUBFOLDER names a
  // CREATOR: the image becomes that creator's public post (find-or-create by
  // handle, merged across users), so a user's u_<user>/posts/<creator>/ folder
  // aggregates under one /people profile (like @sophieraiin). A LOOSE file stays
  // the user's own post. Caption: a "<stem>.md" sidecar, else the [token] title.
  for (const item of collectItems(dir)) {
    if (!isSupportedImage(item.name, "")) {
      // This section only stores images. Videos dropped in a CREATOR folder are
      // handed to the posts importer (scripts/import-posts.mjs knows how to make
      // video post media); anything else is reported instead of vanishing —
      // a silent `continue` here once left mp4 drops sitting unexplained.
      if (isSupportedVideo(item.name, "") && item.collection) {
        try {
          const destDir = path.join(POSTS_ROOT, "_import", item.collection);
          fs.mkdirSync(destDir, { recursive: true });
          moveFile(item.abs, path.join(destDir, item.name));
          res.skipped++;
          res.details.push(
            `posts ${item.name}: video routed to the posts importer (${item.collection})`
          );
        } catch (err) {
          res.skipped++;
          res.details.push(
            `posts ${item.name}: video route failed: ${(err as Error).message}`
          );
        }
      } else if (isSupportedVideo(item.name, "")) {
        res.skipped++;
        res.details.push(
          `posts ${item.name}: loose video (no creator folder) — not supported here`
        );
      }
      continue;
    }
    const [stem] = splitExt(item.name);
    const parsed = parseImportName(stem);
    const md = readCaptionSidecar(item.abs);
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
      buffer = await fsp.readFile(item.abs);
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
          contentHash = await sha256File(mediaPathFor(stored.storageKey));
        } catch {
          /* unreadable just-written file — skip dedup, still import */
        }
        const match = contentHash
          ? (creatorHashSeen.get(creatorId, contentHash) as
              | { id: number }
              | undefined)
          : undefined;
        if (match) {
          // Same content already on this creator — park the source for a
          // side-by-side review instead of silently deleting it.
          deletePostImageFiles(stored.storageKey);
          holdForReview(
            userId,
            item,
            md.sidecar,
            md.caption,
            item.collection as string,
            match.id,
            "exact",
            res
          );
          continue;
        }
      }
      // Perceptual pass: same picture at another resolution/re-compression
      // slips past the exact hash — dHash proposes, SSIM confirms, and a
      // confirmed near-duplicate parks for review like an exact one.
      let newFp: Fingerprint = null;
      if (asCreator && creatorId) {
        const newAbs = mediaPathFor(stored.storageKey);
        newFp = await fingerprintOffThread(newAbs);
        if (newFp) {
          const near = await findNearDuplicate(creatorId, newFp, newAbs);
          if (near) {
            deletePostImageFiles(stored.storageKey);
            holdForReview(
              userId,
              item,
              md.sidecar,
              md.caption,
              item.collection as string,
              near.postId,
              "similar",
              res
            );
            continue;
          }
        }
      }
      // Hashtags from the caption AND the filename's [h_] tokens.
      const tags = new Set<string>(parsed.hashtags);
      if (caption) for (const t of parseHashtags(caption)) tags.add(t);
      // Post + media + hashtags commit atomically so a mid-write failure never
      // leaves an empty posts row behind (which would re-import as a duplicate).
      const { postId, mediaId } = db.transaction(() => {
        const pid = Number(
          (asCreator
            ? insertCreatorPost.run(creatorId, caption)
            : insertUserPost.run(userId, caption)
          ).lastInsertRowid
        );
        const mid = Number(
          insertMedia.run(pid, stored.storageKey, "image/jpeg", stored.width, stored.height, contentHash).lastInsertRowid
        );
        for (const tag of Array.from(tags)) insertHashtag.run(pid, tag);
        return { postId: pid, mediaId: mid };
      })();
      // Rename to a site-relevant self-describing name now that we know the id
      // (outside the transaction — a disk rename must never be rolled back under).
      let finalKey = stored.storageKey;
      try {
        const mediaKey = renamePostImageFiles(stored.storageKey, canonicalStem(parsed, postId, "post"));
        db.prepare("UPDATE post_media SET storage_key = ? WHERE post_id = ?").run(mediaKey, postId);
        finalKey = mediaKey;
      } catch {
        /* keep the original stored name if the rename fails */
      }
      // Seed the scanner's fingerprint cache so the rest of this drop batch —
      // and the next scanner run — compare against the new image.
      if (asCreator && creatorId) {
        cacheMediaFingerprint(mediaId, mediaPathFor(finalKey), contentHash, newFp);
      }
      consumeImported(item.abs, parsed, postId, "post", "posts", res);
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
