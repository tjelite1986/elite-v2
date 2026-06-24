import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import exifr from "exifr";
import { getProfileByUserId } from "./profiles";

// Gallery media now lives PER USER under PROFILE_ROOT, mirroring shorts:
//   <PROFILE_ROOT>/u_<username>/gallery/{originals/<yyyy>/<mm>,thumbs,previews}/
// so an admin can browse or clear everything one account owns in one place. The
// old central GALLERY_ROOT/{originals,thumbs,previews}/<userId>/ layout is kept
// as a read-only fallback, so any file not yet migrated still resolves.
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const STORAGE_ROOT = process.env.GALLERY_ROOT || path.join(DATA_DIR, "gallery");
const PROFILE_ROOT =
  process.env.PROFILE_ROOT || path.join(DATA_DIR, "profile");

// Legacy central roots (pre-per-user). Resolvers fall back to these on read.
export const ORIGINALS_DIR = path.join(STORAGE_ROOT, "originals");
export const THUMBS_DIR = path.join(STORAGE_ROOT, "thumbs");
export const PREVIEWS_DIR = path.join(STORAGE_ROOT, "previews");

// Per-user home folder name (e.g. "u_anna"), using the same filesystem-safe slug
// rule as lib/shorts-storage.ts. Falls back to the numeric id when the account
// has no username. Kept here (not imported from shorts-storage) to avoid a cycle:
// shorts-storage already imports from this module.
function userGalleryRoot(userId: number): string {
  const username = getProfileByUserId(userId)?.username || null;
  const slug = (username || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 64);
  return path.join(PROFILE_ROOT, `u_${slug || userId}`, "gallery");
}

function userOriginalsDir(userId: number): string {
  return path.join(userGalleryRoot(userId), "originals");
}
function userThumbsDir(userId: number): string {
  return path.join(userGalleryRoot(userId), "thumbs");
}
function userPreviewsDir(userId: number): string {
  return path.join(userGalleryRoot(userId), "previews");
}

const THUMB_MAX = 480;
const PREVIEW_MAX = 1600;

const IMAGE_EXTS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "avif",
  "heic",
  "heif",
]);

export function isSupportedImage(filename: string, mime: string): boolean {
  const ext = (path.extname(filename).slice(1) || "").toLowerCase();
  return IMAGE_EXTS.has(ext) || mime.startsWith("image/");
}

const VIDEO_EXTS = new Set(["mp4", "mov", "m4v", "webm", "3gp", "avi", "mkv"]);

const VIDEO_MIME: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  "3gp": "video/3gpp",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
};

export function isSupportedVideo(filename: string, mime: string): boolean {
  const ext = (path.extname(filename).slice(1) || "").toLowerCase();
  return VIDEO_EXTS.has(ext) || mime.startsWith("video/");
}

// Best-effort content type from extension, used when the source didn't supply
// one (e.g. the folder importer passes an empty mime).
export function videoMimeFor(filename: string): string {
  return VIDEO_MIME[getExt(filename)] || "video/mp4";
}

export function getExt(filename: string): string {
  return (path.extname(filename).slice(1) || "bin").toLowerCase();
}

// HEIC/HEIF (iPhone) — sharp's bundled libvips can't decode it, so these need
// converting via heif-convert before any sharp processing.
export function isHeic(filename: string, mime: string): boolean {
  const ext = (path.extname(filename).slice(1) || "").toLowerCase();
  return ext === "heic" || ext === "heif" || mime === "image/heic" || mime === "image/heif";
}

// Convert a HEIC/HEIF buffer to a JPEG buffer using the libheif CLI. EXIF is
// preserved by heif-convert, so downstream date/metadata reads still work.
export function heicToJpeg(buffer: Buffer): Buffer {
  const tmpIn = path.join(os.tmpdir(), `${randomUUID()}.heic`);
  const tmpOut = path.join(os.tmpdir(), `${randomUUID()}.jpg`);
  try {
    fs.writeFileSync(tmpIn, buffer);
    execFileSync("heif-convert", ["-q", "92", tmpIn, tmpOut], { stdio: "ignore" });
    return fs.readFileSync(tmpOut);
  } finally {
    for (const f of [tmpIn, tmpOut]) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch {
        /* best effort */
      }
    }
  }
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export interface IngestPaths {
  storageKey: string;
  originalPath: string;
  thumbPath: string;
  previewPath: string;
}

// Plan the on-disk layout for a new upload, organised originals/<uid>/<yyyy>/<mm>.
export function planIngest(
  userId: number,
  filename: string,
  takenAt: Date
): IngestPaths {
  const ext = getExt(filename);
  const yyyy = String(takenAt.getUTCFullYear());
  const mm = String(takenAt.getUTCMonth() + 1).padStart(2, "0");
  const uuid = randomUUID();

  const originalsDir = path.join(userOriginalsDir(userId), yyyy, mm);
  const thumbsDir = userThumbsDir(userId);
  const previewsDir = userPreviewsDir(userId);
  ensureDir(originalsDir);
  ensureDir(thumbsDir);
  ensureDir(previewsDir);

  return {
    storageKey: `${yyyy}/${mm}/${uuid}.${ext}`,
    originalPath: path.join(originalsDir, `${uuid}.${ext}`),
    thumbPath: path.join(thumbsDir, `${uuid}.jpg`),
    previewPath: path.join(previewsDir, `${uuid}.jpg`),
  };
}

// Prefer the per-user path; fall back to the legacy central path on read so any
// not-yet-migrated file still resolves. New writes always go to the per-user path.
export function originalPathFor(userId: number, storageKey: string): string {
  const p = path.join(userOriginalsDir(userId), storageKey);
  if (fs.existsSync(p)) return p;
  const legacy = path.join(ORIGINALS_DIR, String(userId), storageKey);
  return fs.existsSync(legacy) ? legacy : p;
}

export function thumbPathFor(userId: number, storageKey: string): string {
  const uuid = path.basename(storageKey).replace(/\.[^.]+$/, "");
  const p = path.join(userThumbsDir(userId), `${uuid}.jpg`);
  if (fs.existsSync(p)) return p;
  const legacy = path.join(THUMBS_DIR, String(userId), `${uuid}.jpg`);
  return fs.existsSync(legacy) ? legacy : p;
}

export function previewPathFor(userId: number, storageKey: string): string {
  const uuid = path.basename(storageKey).replace(/\.[^.]+$/, "");
  const p = path.join(userPreviewsDir(userId), `${uuid}.jpg`);
  if (fs.existsSync(p)) return p;
  const legacy = path.join(PREVIEWS_DIR, String(userId), `${uuid}.jpg`);
  return fs.existsSync(legacy) ? legacy : p;
}

export interface ExifMeta {
  takenAt: Date | null;
  latitude: number | null;
  longitude: number | null;
  camera: string | null;
}

// Read capture date + GPS from the ORIGINAL file via exifr, which parses JPEG,
// PNG and (crucially) HEIC/HEIF containers natively — so HEIC GPS isn't lost the
// way it is through heif-convert. exifr returns DateTimeOriginal as a Date built
// from the EXIF wall-clock (no timezone) and latitude/longitude as decimals.
export async function readExifMeta(buffer: Buffer): Promise<ExifMeta> {
  const result: ExifMeta = {
    takenAt: null,
    latitude: null,
    longitude: null,
    camera: null,
  };
  try {
    // `true` = parse all segments (incl. GPS) and compute latitude/longitude.
    const x = await exifr.parse(buffer, true);
    if (!x) return result;

    const make = typeof x.Make === "string" ? x.Make.trim() : "";
    const model = typeof x.Model === "string" ? x.Model.trim() : "";
    // Avoid "Apple Apple iPhone" style repetition.
    const camera =
      model && make && !model.startsWith(make)
        ? `${make} ${model}`
        : model || make;
    if (camera) result.camera = camera;

    const raw =
      x.DateTimeOriginal || x.CreateDate || x.DateTimeDigitized || x.ModifyDate;
    if (raw instanceof Date && !isNaN(raw.getTime())) {
      if (raw.getUTCFullYear() >= 1995 && raw.getTime() <= Date.now() + 86400000) {
        result.takenAt = raw;
      }
    }

    if (
      typeof x.latitude === "number" &&
      typeof x.longitude === "number" &&
      Math.abs(x.latitude) <= 90 &&
      Math.abs(x.longitude) <= 180 &&
      !(x.latitude === 0 && x.longitude === 0)
    ) {
      result.latitude = x.latitude;
      result.longitude = x.longitude;
    }
  } catch {
    /* unreadable EXIF */
  }
  return result;
}

export interface ProcessedImage {
  width: number | null;
  height: number | null;
}

export interface DeriveOptions {
  // Auto-orient from EXIF. TRUE for normal images; FALSE for HEIC, because
  // heif-convert already bakes the rotation into pixels but leaves a (now bogus)
  // EXIF orientation tag — honouring it would double-rotate the photo.
  autoOrient?: boolean;
  // Extra manual rotation in degrees (0/90/180/270), applied after auto-orient.
  rotation?: number;
}

// Generate thumb + preview (and report final dims) from a sharp-decodable
// buffer, applying auto-orient and/or a manual rotation. Splits out so the
// rotate endpoint can regenerate derivatives without touching the original.
export async function regenerateDerivatives(
  paths: Pick<IngestPaths, "thumbPath" | "previewPath">,
  processBuffer: Buffer,
  opts: DeriveOptions = {}
): Promise<ProcessedImage> {
  const { autoOrient = true, rotation = 0 } = opts;

  // Bake EXIF orientation into an upright buffer first so a manual rotation
  // composes cleanly on top of it.
  let upright = processBuffer;
  if (autoOrient) {
    upright = await sharp(processBuffer).rotate().toBuffer();
  }
  const finalBuf =
    rotation % 360 !== 0
      ? await sharp(upright).rotate(rotation).toBuffer()
      : upright;

  let width: number | null = null;
  let height: number | null = null;
  try {
    const meta = await sharp(finalBuf).metadata();
    width = meta.width ?? null;
    height = meta.height ?? null;
  } catch {
    /* leave dims null */
  }

  await sharp(finalBuf)
    .resize(THUMB_MAX, THUMB_MAX, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 72 })
    .toFile(paths.thumbPath);

  await sharp(finalBuf)
    .resize(PREVIEW_MAX, PREVIEW_MAX, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toFile(paths.previewPath);

  return { width, height };
}

// Write the original buffer verbatim, then generate derivatives. `processBuffer`
// is the sharp-decodable image (e.g. a HEIC converted to JPEG).
export async function writeAndProcess(
  paths: IngestPaths,
  buffer: Buffer,
  processBuffer: Buffer = buffer,
  opts: DeriveOptions = {}
): Promise<ProcessedImage> {
  fs.writeFileSync(paths.originalPath, buffer);
  return regenerateDerivatives(paths, processBuffer, opts);
}

export interface VideoMeta {
  takenAt: Date | null;
  latitude: number | null;
  longitude: number | null;
  width: number | null;
  height: number | null;
}

// Probe a video for dimensions, capture date and (Apple) GPS via ffprobe. Reads
// from a file path because ffprobe can't take a buffer. Honours rotation
// side-data so portrait clips report upright dimensions.
export function readVideoMeta(filePath: string): VideoMeta {
  const meta: VideoMeta = {
    takenAt: null,
    latitude: null,
    longitude: null,
    width: null,
    height: null,
  };
  try {
    const out = execFileSync(
      "ffprobe",
      [
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        filePath,
      ],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = JSON.parse(out);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (data.streams || []).find((s: any) => s.codec_type === "video");
    if (v) {
      if (typeof v.width === "number") meta.width = v.width;
      if (typeof v.height === "number") meta.height = v.height;
      const rot = Math.abs(
        Number(v.tags?.rotate ?? v.side_data_list?.[0]?.rotation ?? 0)
      );
      if ((rot === 90 || rot === 270) && meta.width && meta.height) {
        [meta.width, meta.height] = [meta.height, meta.width];
      }
    }
    const tags = { ...(data.format?.tags || {}), ...(v?.tags || {}) };
    const created =
      tags.creation_time || tags["com.apple.quicktime.creationdate"];
    if (created) {
      const d = new Date(created);
      if (
        !isNaN(d.getTime()) &&
        d.getUTCFullYear() >= 1995 &&
        d.getTime() <= Date.now() + 86400000
      ) {
        meta.takenAt = d;
      }
    }
    const loc =
      tags.location ||
      tags["com.apple.quicktime.location.ISO6709"] ||
      tags["location-eng"];
    if (typeof loc === "string") {
      // ISO 6709, e.g. "+58.3654+012.3386+086.500/"
      const m = loc.match(/([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/);
      if (m) {
        const lat = parseFloat(m[1]);
        const lon = parseFloat(m[2]);
        if (
          Math.abs(lat) <= 90 &&
          Math.abs(lon) <= 180 &&
          !(lat === 0 && lon === 0)
        ) {
          meta.latitude = lat;
          meta.longitude = lon;
        }
      }
    }
  } catch {
    /* ffprobe missing or unreadable */
  }
  return meta;
}

// Extract a single poster frame as a JPEG buffer for thumb/preview generation.
// Seeks ~1s in (skips black intro frames); falls back to the very start for
// sub-second clips.
export function extractVideoPoster(filePath: string): Buffer {
  const tmpOut = path.join(os.tmpdir(), `${randomUUID()}.jpg`);
  const run = (seek: string): boolean => {
    try {
      execFileSync(
        "ffmpeg",
        ["-y", "-ss", seek, "-i", filePath, "-frames:v", "1", "-q:v", "3", tmpOut],
        { stdio: "ignore" }
      );
    } catch {
      /* checked by output size below */
    }
    return fs.existsSync(tmpOut) && fs.statSync(tmpOut).size > 0;
  };
  try {
    if (!run("1") && !run("0")) {
      throw new Error("ffmpeg produced no poster frame");
    }
    return fs.readFileSync(tmpOut);
  } finally {
    try {
      if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
    } catch {
      /* best effort */
    }
  }
}

export function deleteMediaFiles(userId: number, storageKey: string) {
  for (const p of [
    originalPathFor(userId, storageKey),
    thumbPathFor(userId, storageKey),
    previewPathFor(userId, storageKey),
  ]) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* best effort */
    }
  }
}
