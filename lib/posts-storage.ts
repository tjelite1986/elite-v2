import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  isSupportedImage,
  isHeic,
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

const DISPLAY_MAX = 1440;
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

// The grid thumbnail lives next to the display image as <uuid>_t.jpg.
export function thumbKeyFor(storageKey: string): string {
  return storageKey.replace(/\.jpg$/i, "_t.jpg");
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

  const source = isHeic(filename, mime) ? heicToJpeg(buffer) : buffer;
  const uuid = randomUUID();
  const storageKey = `${rel}/${uuid}.jpg`;
  const displayPath = path.join(dir, `${uuid}.jpg`);
  const thumbPath = path.join(dir, `${uuid}_t.jpg`);

  // Auto-orient (strip EXIF rotation) and cap the long edge for the feed.
  const upright = await sharp(source).rotate().toBuffer();
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
  const source = isHeic(filename, mime) ? heicToJpeg(buffer) : buffer;
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
function moveFile(src: string, dest: string): void {
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

  let base = path.basename(storageKey); // "<uuid>.jpg"
  const srcDisplay = mediaPathFor(storageKey);
  let destDisplay = path.join(destDir, base);
  if (
    fs.existsSync(destDisplay) &&
    path.resolve(srcDisplay) !== path.resolve(destDisplay)
  ) {
    const stem = base.slice(0, -".jpg".length);
    base = `${stem}_${randomUUID().slice(0, 8)}.jpg`;
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
  const source = isHeic(filename, mime) ? heicToJpeg(buffer) : buffer;
  const uuid = randomUUID();
  const key = `${BANNERS_SUBDIR}/${uuid}.jpg`;
  await sharp(source)
    .rotate()
    .resize(BANNER_W, BANNER_H, { fit: "cover" })
    .jpeg({ quality: 82 })
    .toFile(path.join(dir, `${uuid}.jpg`));
  return key;
}

// Rename a freshly stored post image (display + thumbnail) to a canonical,
// self-describing basename "<stem>.jpg" within the same folder, so the file
// round-trips through the importer. `newStem` is assembled by the caller; here we
// only strip path-breaking characters. Returns the new storage_key; the caller
// persists it. A real collision gets a short suffix.
export function renamePostImageFiles(storageKey: string, newStem: string): string {
  const dir = path.dirname(storageKey);
  const safe =
    newStem.replace(/[/:*?"<>| ]+/g, " ").replace(/\s+/g, " ").trim() || "post";
  const keyFor = (stem: string) => (dir === "." ? `${stem}.jpg` : `${dir}/${stem}.jpg`);

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
