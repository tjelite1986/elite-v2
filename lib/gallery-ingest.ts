import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { parseFilenameDate } from "./filename-date";
import {
  isSupportedImage,
  isSupportedVideo,
  isHeic,
  heicToJpeg,
  planIngest,
  writeAndProcess,
  regenerateDerivatives,
  readExifMeta,
  readVideoMeta,
  extractVideoPoster,
  videoMimeFor,
} from "./gallery-storage";

function toSqlite(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19);
}

function resolveTakenAt(
  exifDate: Date | null,
  filename: string,
  fallbackMs: number | null
): Date {
  if (exifDate) return exifDate;
  const fromName = parseFilenameDate(filename);
  if (fromName) return fromName;
  if (fallbackMs && fallbackMs > 0) {
    const d = new Date(fallbackMs);
    if (d.getFullYear() >= 1995) return d;
  }
  return new Date();
}

// Shared ingest used by both the upload route and the folder-import route.
// Reads date + GPS from the ORIGINAL via exifr (so HEIC location survives),
// converts HEIC for thumbnailing, and inserts the row. Returns the new id, or
// null if the file isn't a supported image.
export async function ingestImage(
  userId: number,
  filename: string,
  mime: string,
  buffer: Buffer,
  fallbackMs: number | null = null
): Promise<number | null> {
  if (!isSupportedImage(filename, mime)) return null;

  const heic = isHeic(filename, mime);
  const processBuffer = heic ? heicToJpeg(buffer) : buffer;

  const exif = await readExifMeta(buffer);
  const takenAt = resolveTakenAt(exif.takenAt, filename, fallbackMs);
  const paths = planIngest(userId, filename, takenAt);
  const { width, height } = await writeAndProcess(paths, buffer, processBuffer, {
    autoOrient: !heic,
  });

  const result = db
    .prepare(
      `INSERT INTO gallery_items
         (user_id, filename, storage_key, mime_type, size_bytes, width, height, latitude, longitude, camera, taken_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      filename,
      paths.storageKey,
      mime || "image/jpeg",
      buffer.length,
      width,
      height,
      exif.latitude,
      exif.longitude,
      exif.camera,
      toSqlite(takenAt)
    );
  return Number(result.lastInsertRowid);
}

// Ingest a video: store the original verbatim, probe date/GPS/dimensions with
// ffprobe, and generate the thumb + preview from an extracted poster frame.
export async function ingestVideo(
  userId: number,
  filename: string,
  mime: string,
  buffer: Buffer,
  fallbackMs: number | null = null
): Promise<number | null> {
  if (!isSupportedVideo(filename, mime)) return null;

  // ffprobe/ffmpeg need a file path, and we must know taken_at (which decides
  // the originals/<yyyy>/<mm> folder) before planning the final path — so probe
  // a temp copy first.
  const tmp = path.join(os.tmpdir(), `${randomUUID()}-${path.basename(filename)}`);
  fs.writeFileSync(tmp, buffer);
  try {
    const meta = readVideoMeta(tmp);
    const takenAt = resolveTakenAt(meta.takenAt, filename, fallbackMs);
    const paths = planIngest(userId, filename, takenAt);
    fs.writeFileSync(paths.originalPath, buffer);

    let width = meta.width;
    let height = meta.height;
    try {
      const poster = extractVideoPoster(tmp);
      // Poster is already upright (ffmpeg applies the display matrix on decode),
      // so don't auto-orient again.
      const dims = await regenerateDerivatives(paths, poster, {
        autoOrient: false,
      });
      if (!width) width = dims.width;
      if (!height) height = dims.height;
    } catch (err) {
      console.error(`[gallery] poster extraction failed for ${filename}:`, err);
    }

    const result = db
      .prepare(
        `INSERT INTO gallery_items
           (user_id, filename, storage_key, mime_type, size_bytes, width, height, latitude, longitude, camera, taken_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        filename,
        paths.storageKey,
        mime || videoMimeFor(filename),
        buffer.length,
        width,
        height,
        meta.latitude,
        meta.longitude,
        null,
        toSqlite(takenAt)
      );
    return Number(result.lastInsertRowid);
  } finally {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* best effort */
    }
  }
}

// Unified entry point: dispatch to the video or image ingest based on the
// filename/mime. Returns the new row id, or null if it's neither.
export async function ingestMedia(
  userId: number,
  filename: string,
  mime: string,
  buffer: Buffer,
  fallbackMs: number | null = null
): Promise<number | null> {
  if (isSupportedVideo(filename, mime)) {
    return ingestVideo(userId, filename, mime, buffer, fallbackMs);
  }
  if (isSupportedImage(filename, mime)) {
    return ingestImage(userId, filename, mime, buffer, fallbackMs);
  }
  return null;
}
