import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  isSupportedImage,
  isHeifBuffer,
  heicToJpeg,
  getExt,
} from "./gallery-storage";

// Storage for the posts module. Standalone from the gallery/shorts: defaults
// under the data volume but in production it's a bind-mounted host folder
// (POSTS_ROOT) at /mnt/4tb/elitev2/posts. Layout:
//   <author-slug>/<uuid>.jpg      display image (auto-oriented, capped)
//   <author-slug>/<uuid>_t.jpg    square thumbnail for grids
//   avatars/<uuid>.jpg            user/creator avatars
//   _import/                      drop folder for the creator importer
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
export const POSTS_ROOT =
  process.env.POSTS_ROOT || path.join(DATA_DIR, "posts");
// Per-user content home (shared with shorts/gallery). A user's OWN posts live
// under <PROFILE_ROOT>/u_<user>/posts/, so everything one account owns sits in
// one browsable place; mirrored creators keep the shared POSTS_ROOT layout.
const PROFILE_ROOT = process.env.PROFILE_ROOT || path.join(DATA_DIR, "profile");

// A post media key is SELF-DESCRIBING: a user-upload key looks like
// "u_<user>/posts/<uuid>.jpg" and resolves under PROFILE_ROOT; every other key
// (creators/imports/stories/avatars) resolves under POSTS_ROOT. So the path
// resolvers below need no extra flag and a key survives independent of context.
function isPostUploadKey(key: string): boolean {
  return /^u_[^/]+\/posts\//.test(key);
}

export const AVATARS_SUBDIR = "avatars";
export const BANNERS_SUBDIR = "banners";
export const IMPORT_SUBDIR = "_import";

const DISPLAY_MAX = 2048;
const THUMB_SIZE = 600;
const AVATAR_SIZE = 320;
const BANNER_W = 1500;
const BANNER_H = 500;

// Filesystem-safe folder name for an author (user or creator), matching the
// username slug rules so an author maps to one folder. Kept identical to the
// importer's slug so re-runs are stable.
export function authorSlug(name: string | null | undefined): string {
  const slug = (name || "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 64);
  return slug || "unknown";
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Absolute path for a media key. User-upload keys (u_<user>/posts/…) resolve
// under PROFILE_ROOT; all others under POSTS_ROOT.
export function mediaPathFor(storageKey: string): string {
  return isPostUploadKey(storageKey)
    ? path.join(PROFILE_ROOT, storageKey)
    : path.join(POSTS_ROOT, storageKey);
}

// The grid thumbnail lives next to the display file as <stem>_t.jpg. Videos get
// the same convention: their _t.jpg is a poster frame extracted at store time.
export function thumbKeyFor(storageKey: string): string {
  return storageKey.replace(/\.[^./]+$/, "") + "_t.jpg";
}

// True for a post media key that points at a video file.
export function isVideoKey(storageKey: string): boolean {
  return /\.(mp4|m4v|webm)$/i.test(storageKey);
}

export function avatarPathFor(avatarKey: string): string {
  return path.join(POSTS_ROOT, avatarKey);
}

export interface StoredPostImage {
  storageKey: string;
  mimeType: string; // always image/jpeg (we transcode)
  width: number | null;
  height: number | null;
}

// Persist one post image: convert HEIC if needed, auto-orient, write a capped
// display JPEG + a square thumbnail under the author's folder. Throws if the
// file isn't a supported image so the caller can reject the upload.
export async function storePostImage(
  slug: string,
  filename: string,
  mime: string,
  buffer: Buffer,
  // When set (e.g. "u_anna"), the image is a user's OWN post and is stored under
  // <PROFILE_ROOT>/<userHome>/posts/ with a self-describing key. Omit for
  // creators/imports, which stay under POSTS_ROOT/<slug>/.
  userHome?: string | null
): Promise<StoredPostImage> {
  if (!isSupportedImage(filename, mime)) {
    throw new Error("Unsupported file type — images only");
  }

  const rel = userHome ? `${userHome}/posts` : slug;
  const dir = path.join(userHome ? PROFILE_ROOT : POSTS_ROOT, rel);
  ensureDir(dir);

  const source = isHeifBuffer(buffer) ? heicToJpeg(buffer) : buffer;
  const uuid = randomUUID();
  const storageKey = `${rel}/${uuid}.jpg`;
  const displayPath = path.join(dir, `${uuid}.jpg`);
  const thumbPath = path.join(dir, `${uuid}_t.jpg`);

  // Auto-orient (strip EXIF rotation) and cap the long edge for the feed.
  // failOn: "none" — sharp aborts by default on recoverable JPEG warnings
  // ("Corrupt JPEG data: N extraneous bytes"), which are common in scraped
  // images and would otherwise block an otherwise-fine import.
  const upright = await sharp(source, { failOn: "none" }).rotate().toBuffer();
  const meta = await sharp(upright).metadata();

  await sharp(upright)
    .resize(DISPLAY_MAX, DISPLAY_MAX, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toFile(displayPath);

  await sharp(upright)
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: "cover" })
    .jpeg({ quality: 75 })
    .toFile(thumbPath);

  return {
    storageKey,
    mimeType: "image/jpeg",
    width: meta.width ?? null,
    height: meta.height ?? null,
  };
}

// Video extensions accepted into a post. MOV is remuxed into MP4 (same codecs,
// browser-playable container); everything else keeps its container.
const POST_VIDEO_EXTS = new Set(["mp4", "m4v", "mov", "webm"]);

export function isSupportedPostVideo(filename: string, mime: string): boolean {
  return POST_VIDEO_EXTS.has(getExt(filename)) || mime.startsWith("video/");
}

// Extract a square poster frame for grids/players as <stem>_t.jpg (the same
// slot the image thumbnail uses, so ?size=thumb works for both media kinds).
// Deep seeks can yield no frame on sparse-keyframe files — fall back earlier.
function makeVideoPoster(videoPath: string, posterPath: string): void {
  for (const seek of ["1", "0"]) {
    try {
      execFileSync(
        "ffmpeg",
        ["-y", "-hide_banner", "-loglevel", "error", "-nostdin",
         "-ss", seek, "-i", videoPath, "-vframes", "1",
         "-vf", `scale=${THUMB_SIZE}:${THUMB_SIZE}:force_original_aspect_ratio=increase,crop=${THUMB_SIZE}:${THUMB_SIZE}`,
         "-q:v", "5", posterPath],
        { stdio: "ignore" }
      );
    } catch {
      /* try the next seek */
    }
    if (fs.existsSync(posterPath) && fs.statSync(posterPath).size > 0) return;
  }
  throw new Error("Could not read a frame from the video.");
}

function videoDimensions(filePath: string): { width: number | null; height: number | null } {
  try {
    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0",
       "-show_entries", "stream=width,height", "-of", "csv=p=0", filePath],
      { encoding: "utf8" }
    );
    const [w, h] = out.trim().split(",").map((n) => parseInt(n, 10));
    return { width: Number.isFinite(w) ? w : null, height: Number.isFinite(h) ? h : null };
  } catch {
    return { width: null, height: null };
  }
}

// Persist one post video: MP4-family sources are remuxed (stream copy, no
// quality loss) to a faststart MP4 so playback starts before the full download;
// WebM is stored as-is. A square poster frame is written as the _t.jpg thumb.
// Throws when the file has no readable video stream (e.g. an audio-only file).
export async function storePostVideo(
  slug: string,
  filename: string,
  buffer: Buffer,
  userHome?: string | null
): Promise<StoredPostImage> {
  const ext = getExt(filename);
  if (!POST_VIDEO_EXTS.has(ext)) {
    throw new Error("Unsupported video type — use MP4, MOV or WebM.");
  }

  const rel = userHome ? `${userHome}/posts` : slug;
  const dir = path.join(userHome ? PROFILE_ROOT : POSTS_ROOT, rel);
  ensureDir(dir);

  const uuid = randomUUID();
  const srcPath = path.join(dir, `${uuid}.src.${ext}`);
  fs.writeFileSync(srcPath, buffer);

  const finalExt = ext === "webm" ? "webm" : "mp4";
  const finalPath = path.join(dir, `${uuid}.${finalExt}`);
  const storageKey = `${rel}/${uuid}.${finalExt}`;
  try {
    if (ext === "webm") {
      fs.renameSync(srcPath, finalPath);
    } else {
      try {
        execFileSync(
          "ffmpeg",
          ["-y", "-hide_banner", "-loglevel", "error", "-nostdin",
           "-i", srcPath, "-c", "copy", "-movflags", "+faststart", finalPath],
          { stdio: "ignore" }
        );
        fs.rmSync(srcPath, { force: true });
      } catch {
        // Remux failed (odd container/codec combo). An mp4/m4v source is
        // already playable — keep the original bytes; a mov that won't remux
        // wouldn't play in browsers anyway.
        fs.rmSync(finalPath, { force: true });
        if (ext === "mov") throw new Error("Could not convert this video.");
        fs.renameSync(srcPath, finalPath);
      }
    }

    makeVideoPoster(finalPath, path.join(dir, `${uuid}_t.jpg`));
    const { width, height } = videoDimensions(finalPath);
    return {
      storageKey,
      mimeType: finalExt === "webm" ? "video/webm" : "video/mp4",
      width,
      height,
    };
  } catch (err) {
    fs.rmSync(srcPath, { force: true });
    fs.rmSync(finalPath, { force: true });
    fs.rmSync(path.join(dir, `${uuid}_t.jpg`), { force: true });
    throw err;
  }
}

// Persist a post video from an on-disk file (no buffering) — used when moving
// a short into the posts Videos tab. Same handling as storePostVideo: MP4-family
// sources are remuxed to a faststart MP4 (stream copy, no quality loss), WebM is
// copied as-is, and a square poster frame is written as the _t.jpg thumb. The
// SOURCE file is left in place; the caller decides when to delete it.
export function storePostVideoFromFile(
  slug: string,
  srcPath: string,
  userHome?: string | null
): StoredPostImage {
  const ext = getExt(srcPath);
  const rel = userHome ? `${userHome}/posts` : slug;
  const dir = path.join(userHome ? PROFILE_ROOT : POSTS_ROOT, rel);
  ensureDir(dir);

  const uuid = randomUUID();
  const finalExt = ext === "webm" ? "webm" : "mp4";
  const finalPath = path.join(dir, `${uuid}.${finalExt}`);
  try {
    if (finalExt === "webm") {
      fs.copyFileSync(srcPath, finalPath);
    } else {
      try {
        execFileSync(
          "ffmpeg",
          ["-y", "-hide_banner", "-loglevel", "error", "-nostdin",
           "-i", srcPath, "-c", "copy", "-movflags", "+faststart", finalPath],
          { stdio: "ignore" }
        );
      } catch {
        fs.rmSync(finalPath, { force: true });
        fs.copyFileSync(srcPath, finalPath);
      }
    }

    makeVideoPoster(finalPath, path.join(dir, `${uuid}_t.jpg`));
    const { width, height } = videoDimensions(finalPath);
    return {
      storageKey: `${rel}/${uuid}.${finalExt}`,
      mimeType: finalExt === "webm" ? "video/webm" : "video/mp4",
      width,
      height,
    };
  } catch (err) {
    fs.rmSync(finalPath, { force: true });
    fs.rmSync(path.join(dir, `${uuid}_t.jpg`), { force: true });
    throw err;
  }
}

// Persist an avatar (square crop). Returns the avatar_key.
export async function storeAvatar(
  filename: string,
  mime: string,
  buffer: Buffer
): Promise<string> {
  if (!isSupportedImage(filename, mime)) {
    throw new Error("Unsupported file type — images only");
  }
  const dir = path.join(POSTS_ROOT, AVATARS_SUBDIR);
  ensureDir(dir);
  const source = isHeifBuffer(buffer) ? heicToJpeg(buffer) : buffer;
  const uuid = randomUUID();
  const key = `${AVATARS_SUBDIR}/${uuid}.jpg`;
  await sharp(source)
    .rotate()
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover" })
    .jpeg({ quality: 82 })
    .toFile(path.join(dir, `${uuid}.jpg`));
  return key;
}

// rename(2) fails with EXDEV when source and destination sit on different bind
// mounts (a user upload under PROFILE_ROOT moving to a creator folder under
// POSTS_ROOT — separate volumes in production) — fall back to copy + unlink.
export function moveFile(src: string, dest: string): void {
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    fs.copyFileSync(src, dest);
    fs.unlinkSync(src);
  }
}

// Move a post image (display + thumbnail) into another author's folder, keeping
// the basename so the by-id media route resolves unchanged. Used when an admin
// reassigns a post to a different author. Returns the new storage_key. On a
// basename collision in the destination a short suffix is added so two images
// never clobber each other.
export function movePostImageToAuthor(
  storageKey: string,
  newAuthorName: string
): string {
  const slug = authorSlug(newAuthorName);
  const destDir = path.join(POSTS_ROOT, slug);
  ensureDir(destDir);

  let base = path.basename(storageKey); // "<uuid>.jpg" / "<uuid>.mp4"
  const ext = path.extname(base);
  const srcDisplay = mediaPathFor(storageKey);
  let destDisplay = path.join(destDir, base);
  if (
    fs.existsSync(destDisplay) &&
    path.resolve(srcDisplay) !== path.resolve(destDisplay)
  ) {
    const stem = base.slice(0, -ext.length);
    base = `${stem}_${randomUUID().slice(0, 8)}${ext}`;
    destDisplay = path.join(destDir, base);
  }

  // Move the display image, then its thumbnail alongside.
  moveFile(srcDisplay, destDisplay);
  const newKey = `${slug}/${base}`;

  const srcThumb = mediaPathFor(thumbKeyFor(storageKey));
  if (fs.existsSync(srcThumb)) {
    try {
      moveFile(srcThumb, mediaPathFor(thumbKeyFor(newKey)));
    } catch {
      /* best effort — thumbnail can be regenerated */
    }
  }
  return newKey;
}

// Persist a profile cover banner (wide crop). Returns the banner_key.
export async function storeBanner(
  filename: string,
  mime: string,
  buffer: Buffer
): Promise<string> {
  if (!isSupportedImage(filename, mime)) {
    throw new Error("Unsupported file type — images only");
  }
  const dir = path.join(POSTS_ROOT, BANNERS_SUBDIR);
  ensureDir(dir);
  const source = isHeifBuffer(buffer) ? heicToJpeg(buffer) : buffer;
  const uuid = randomUUID();
  const key = `${BANNERS_SUBDIR}/${uuid}.jpg`;
  await sharp(source)
    .rotate()
    .resize(BANNER_W, BANNER_H, { fit: "cover" })
    .jpeg({ quality: 82 })
    .toFile(path.join(dir, `${uuid}.jpg`));
  return key;
}

// Rename a freshly stored post media file (display + thumbnail) to a canonical,
// self-describing basename "<stem>.<ext>" within the same folder (the original
// extension is kept), so the file round-trips through the importer. `newStem` is
// assembled by the caller; here we only strip path-breaking characters. Returns
// the new storage_key; the caller persists it. A real collision gets a suffix.
export function renamePostImageFiles(storageKey: string, newStem: string): string {
  const dir = path.dirname(storageKey);
  const ext = path.extname(storageKey) || ".jpg";
  const safe =
    newStem.replace(/[/:*?"<>| ]+/g, " ").replace(/\s+/g, " ").trim() || "post";
  const keyFor = (stem: string) => (dir === "." ? `${stem}${ext}` : `${dir}/${stem}${ext}`);

  const src = mediaPathFor(storageKey);
  let finalStem = safe;
  if (
    fs.existsSync(mediaPathFor(keyFor(safe))) &&
    path.resolve(src) !== path.resolve(mediaPathFor(keyFor(safe)))
  ) {
    finalStem = `${safe}_${randomUUID().slice(0, 8)}`;
  }
  const newKey = keyFor(finalStem);
  fs.renameSync(src, mediaPathFor(newKey));

  const srcThumb = mediaPathFor(thumbKeyFor(storageKey));
  if (fs.existsSync(srcThumb)) {
    try {
      fs.renameSync(srcThumb, mediaPathFor(thumbKeyFor(newKey)));
    } catch {
      /* thumbnail is regenerable */
    }
  }
  return newKey;
}

// Remove a post image's display + thumbnail (best effort).
export function deletePostImageFiles(storageKey: string) {
  for (const p of [mediaPathFor(storageKey), mediaPathFor(thumbKeyFor(storageKey))]) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* best effort */
    }
  }
}

// We only ever write .jpg, but keep the route's Content-Type honest from the
// on-disk extension (never echo a client-supplied mime).
const IMAGE_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export function imageMimeFor(filename: string): string {
  return IMAGE_MIME[getExt(filename)] || "image/jpeg";
}

// Post media can also be video since the Videos tab; same never-echo rule.
const VIDEO_MIME: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
};

export function mediaMimeFor(filename: string): string {
  return VIDEO_MIME[getExt(filename)] || imageMimeFor(filename);
}
