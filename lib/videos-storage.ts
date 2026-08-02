import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

// Long-form video library. Unlike shorts (per-creator vertical clips) this is a
// SHARED, folder-driven library: the files on disk are the source of truth and a
// scan mirrors them into the DB. Layout:
//   <VIDEOS_ROOT>/main/...      normal videos
//   <VIDEOS_ROOT>/adults/...    18+ videos
//   <VIDEOS_ROOT>/.posters/     generated poster frames + scrub storyboards
// Subfolders inside a channel are kept as a browsable "folder" facet, so a
// series/collection dropped as a directory stays grouped in the UI.
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");

export const VIDEOS_ROOT =
  process.env.VIDEOS_ROOT || path.join(DATA_DIR, "videos");

export const VIDEO_CHANNELS = ["main", "adults"] as const;
export type VideoChannel = (typeof VIDEO_CHANNELS)[number];

// Directory holding generated artwork. Dot-prefixed so the scanner skips it.
const POSTERS_DIRNAME = ".posters";

export function parseVideoChannel(value: unknown): VideoChannel | null {
  return VIDEO_CHANNELS.includes(value as VideoChannel)
    ? (value as VideoChannel)
    : null;
}

export function channelDir(channel: VideoChannel): string {
  return path.join(VIDEOS_ROOT, channel);
}

export function postersDir(): string {
  return path.join(VIDEOS_ROOT, POSTERS_DIRNAME);
}

export function ensureVideoDirs() {
  for (const dir of [
    VIDEOS_ROOT,
    ...VIDEO_CHANNELS.map(channelDir),
    postersDir(),
  ]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

export function videoFilePath(
  channel: VideoChannel,
  storageKey: string
): string {
  return path.join(channelDir(channel), storageKey);
}

export function posterFilePath(posterKey: string): string {
  return path.join(postersDir(), posterKey);
}

// Artwork names are derived from channel + storage key, so a rescan of the same
// file reuses (and does not orphan) its poster/storyboard.
export function artworkStem(channel: VideoChannel, storageKey: string): string {
  return createHash("sha1").update(`${channel}/${storageKey}`).digest("hex");
}

// Guard against path traversal: a resolved media path must stay inside its
// channel directory (a storage key comes from the DB, but the DB is fed by a
// scan of arbitrary on-disk names, so it is never trusted blindly).
export function isUnderChannel(
  channel: VideoChannel,
  filePath: string
): boolean {
  const root = path.resolve(channelDir(channel));
  const resolved = path.resolve(filePath);
  return resolved === root || resolved.startsWith(root + path.sep);
}

export function isUnderPosters(filePath: string): boolean {
  const root = path.resolve(postersDir());
  const resolved = path.resolve(filePath);
  return resolved.startsWith(root + path.sep);
}

const VIDEO_EXTS = new Set([
  "mp4",
  "m4v",
  "mkv",
  "webm",
  "mov",
  "avi",
  "ts",
  "m2ts",
  "mpg",
  "mpeg",
  "wmv",
  "flv",
]);

export function isVideoFile(filename: string): boolean {
  return VIDEO_EXTS.has(path.extname(filename).slice(1).toLowerCase());
}

const VIDEO_MIME: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mkv: "video/x-matroska",
  webm: "video/webm",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  ts: "video/mp2t",
  m2ts: "video/mp2t",
  mpg: "video/mpeg",
  mpeg: "video/mpeg",
  wmv: "video/x-ms-wmv",
  flv: "video/x-flv",
};

// Content-Type is derived from the on-disk extension via a fixed allowlist —
// never from a caller-supplied value — so a stored file can't be served as
// text/html (stored XSS). Combined with nosniff on the stream route.
export function videoMime(filename: string): string {
  return VIDEO_MIME[path.extname(filename).slice(1).toLowerCase()] || "video/mp4";
}

export type ScannedFile = {
  storageKey: string;
  folder: string;
  size: number;
  mtime: string;
};

// Recursive walk of a channel directory. Returns every video file keyed by its
// path relative to the channel root. Hidden files/dirs (incl. .posters) and
// unfinished downloads (*.part, *.crdownload) are skipped.
export function walkChannel(channel: VideoChannel): ScannedFile[] {
  const root = channelDir(channel);
  const out: ScannedFile[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile() || !isVideoFile(entry.name)) continue;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      const storageKey = path.relative(root, full).split(path.sep).join("/");
      const dirname = path.dirname(storageKey);
      out.push({
        storageKey,
        folder: dirname === "." ? "" : dirname,
        size: stat.size,
        mtime: new Date(stat.mtimeMs).toISOString(),
      });
    }
  };
  walk(root);
  return out;
}

// True when the channel directory exists and holds at least one entry. A
// production media root is a bind mount that always has content, so an empty
// root almost certainly means the volume is not mounted — the scan must not
// then delete every row as "file missing".
export function channelAvailable(channel: VideoChannel): boolean {
  try {
    return fs.readdirSync(channelDir(channel)).length > 0;
  } catch {
    return false;
  }
}
