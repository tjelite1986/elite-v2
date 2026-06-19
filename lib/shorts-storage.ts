import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  extractVideoPoster,
  isSupportedVideo,
  readVideoMeta,
  videoMimeFor,
  getExt,
} from "./gallery-storage";
import type { ShortChannel } from "./db";

// Shorts media root. Standalone from the gallery: defaults under the data volume
// but in production it's a bind-mounted host folder (SHORTS_ROOT) so the host
// transcoder (phase v1b) can reach the files. Layout: <channel>/<uuid>.<ext>
// for the video and <channel>/<uuid>.jpg for the poster frame.
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
export const SHORTS_ROOT =
  process.env.SHORTS_ROOT || path.join(DATA_DIR, "shorts");

const POSTER_MAX = 720;

// User uploads have no auto-poll profile, so they land in this subfolder.
export const UPLOADS_SUBDIR = "_uploads";

export function channelDir(channel: ShortChannel): string {
  return path.join(SHORTS_ROOT, channel === "18plus" ? "18plus" : "main");
}

// Filesystem-safe folder name for a profile, so clips live under
// shorts/<channel>/<slug>/ (browsable per creator, like the old elite layout).
// Must stay identical to the slug used by scripts/poll-shorts.mjs and the
// migration so a profile always maps to one folder.
export function profileSlug(name: string | null | undefined): string {
  const slug = (name || "unknown")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 64);
  return slug || "unknown";
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function videoPathFor(channel: ShortChannel, storageKey: string): string {
  return path.join(channelDir(channel), storageKey);
}

export function posterPathFor(
  channel: ShortChannel,
  posterKey: string
): string {
  return path.join(channelDir(channel), posterKey);
}

export interface StoredShort {
  storageKey: string; // e.g. "<uuid>.mp4"
  posterKey: string | null; // e.g. "<uuid>.jpg"
  mimeType: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  sizeBytes: number;
}

// Persist an uploaded short: write the original video verbatim, probe it for
// dimensions/duration, and extract a poster frame. Throws if the file isn't a
// supported video so the caller can reject the upload.
export async function storeShortUpload(
  channel: ShortChannel,
  filename: string,
  mime: string,
  buffer: Buffer,
  subfolder: string = UPLOADS_SUBDIR
): Promise<StoredShort> {
  if (!isSupportedVideo(filename, mime)) {
    throw new Error("Unsupported file type — videos only");
  }

  const dir = path.join(channelDir(channel), subfolder);
  ensureDir(dir);

  const uuid = randomUUID();
  const ext = getExt(filename);
  // storageKey/posterKey are relative to the channel dir and include the
  // subfolder, so videoPathFor()/posterPathFor() resolve unchanged.
  const storageKey = `${subfolder}/${uuid}.${ext}`;
  const videoPath = path.join(dir, `${uuid}.${ext}`);
  fs.writeFileSync(videoPath, buffer);

  const meta = readVideoMeta(videoPath);

  // Best-effort poster. A failure here shouldn't fail the upload — the feed
  // falls back to the <video> element's own first frame.
  let posterKey: string | null = null;
  try {
    const posterBuf = extractVideoPoster(videoPath);
    posterKey = `${subfolder}/${uuid}.jpg`;
    await sharp(posterBuf)
      .resize(POSTER_MAX, POSTER_MAX, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 78 })
      .toFile(path.join(dir, `${uuid}.jpg`));
  } catch {
    posterKey = null;
  }

  // Don't trust the client-supplied mime. Keep it only if it's a well-formed
  // video/* type; otherwise derive it from the extension. The video route
  // re-derives Content-Type from the extension regardless, so this is defence
  // in depth for anything else that reads mime_type.
  const safeMime =
    /^video\/[a-z0-9.+-]+$/i.test(mime) ? mime : videoMimeFor(filename);

  return {
    storageKey,
    posterKey,
    mimeType: safeMime,
    width: meta.width,
    height: meta.height,
    duration: durationFromProbe(videoPath),
    sizeBytes: buffer.length,
  };
}

// readVideoMeta doesn't expose duration, so do a tiny dedicated probe. Returns
// null when ffprobe is missing or the value is unparseable.
function durationFromProbe(filePath: string): number | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execFileSync } = require("node:child_process");
    const out = execFileSync(
      "ffprobe",
      [
        "-v",
        "quiet",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { encoding: "utf8" }
    );
    const d = parseFloat(String(out).trim());
    return isNaN(d) ? null : d;
  } catch {
    return null;
  }
}

// Capture a poster from a specific point in the video (the admin "set cover"
// action while watching), since auto-extracted frames aren't always flattering.
// Writes a new poster file in the same folder as the video, deletes the old
// one, and returns the new poster storageKey. Throws if no frame is produced.
export async function setCustomPoster(
  channel: ShortChannel,
  storageKey: string,
  oldPosterKey: string | null,
  timeSeconds: number
): Promise<string> {
  const videoPath = videoPathFor(channel, storageKey);
  if (!fs.existsSync(videoPath)) throw new Error("Video file missing");

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { execFileSync } = require("node:child_process");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require("node:os");

  const tmpOut = path.join(os.tmpdir(), `${randomUUID()}.jpg`);
  const seek = Math.max(0, Number(timeSeconds) || 0).toFixed(2);
  try {
    execFileSync(
      "ffmpeg",
      ["-y", "-ss", seek, "-i", videoPath, "-frames:v", "1", "-q:v", "3", tmpOut],
      { stdio: "ignore" }
    );
    if (!fs.existsSync(tmpOut) || fs.statSync(tmpOut).size === 0) {
      throw new Error("ffmpeg produced no frame at that time");
    }

    const dir = path.dirname(storageKey); // same folder as the video
    const newKey =
      dir === "." ? `${randomUUID()}.jpg` : `${dir}/${randomUUID()}.jpg`;
    const newPath = posterPathFor(channel, newKey);
    ensureDir(path.dirname(newPath));
    await sharp(tmpOut)
      .resize(POSTER_MAX, POSTER_MAX, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(newPath);

    if (oldPosterKey && oldPosterKey !== newKey) {
      const oldPath = posterPathFor(channel, oldPosterKey);
      try {
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      } catch {
        /* best effort */
      }
    }
    return newKey;
  } finally {
    try {
      if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
    } catch {
      /* best effort */
    }
  }
}

export function deleteShortFiles(
  channel: ShortChannel,
  storageKey: string,
  posterKey: string | null
) {
  const targets = [videoPathFor(channel, storageKey)];
  if (posterKey) targets.push(posterPathFor(channel, posterKey));
  for (const p of targets) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* best effort */
    }
  }
}
