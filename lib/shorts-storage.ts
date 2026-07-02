import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  extractVideoPoster,
  isSupportedVideo,
  readVideoMeta,
  videoMimeFor,
} from "./gallery-storage";
import type { ShortChannel } from "./db";
import { IMPORT_ROOT, PROFILE_SECTIONS, IMPORT_SECTIONS } from "./storage-roots";

// Shorts media root. Standalone from the gallery: defaults under the data volume
// but in production it's a bind-mounted host folder (SHORTS_ROOT) so the host
// transcoder (phase v1b) can reach the files. Layout: <channel>/<uuid>.<ext>
// for the video and <channel>/<uuid>.jpg for the poster frame.
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
export const SHORTS_ROOT =
  process.env.SHORTS_ROOT || path.join(DATA_DIR, "shorts");

// Per-USER content home. Each account's own uploads live under
// <PROFILE_ROOT>/u_<user>/<section>/... — shorts go to u_<user>/shorts/<channel>/,
// and later gallery/posts get u_<user>/gallery/ etc. on the same root, so an
// admin can browse or clear everything one user owns in one place. Distinct from
// the shared SHORTS_ROOT/<channel>/<creator> layout used by imports/auto-polls.
export const PROFILE_ROOT =
  process.env.PROFILE_ROOT || path.join(DATA_DIR, "profile");

const POSTER_MAX = 720;

// Per-user home folder name for an account (filesystem-safe), e.g. "u_anna".
// Falls back to the numeric id when the user has no username yet.
export function userHomeDir(userId: number, username?: string | null): string {
  const slug = username ? profileSlug(username) : "unknown";
  return `u_${slug && slug !== "unknown" ? slug : userId}`;
}

// A short's storage key is SELF-DESCRIBING about where the file lives: a user
// upload key looks like "u_<user>/shorts/<channel>/<file>" and resolves under
// PROFILE_ROOT; every other key (imports/auto-polls) resolves under
// SHORTS_ROOT/<channel>. So the path resolvers below need no extra flag, and a
// key survives moves (reassigning an upload to a creator profile drops the
// u_.../shorts/ prefix, which flips its resolution automatically).
function isUploadKey(key: string): boolean {
  // Per-user upload keys live under u_<user>/shorts/ (main) or u_<user>/shorts18/
  // (18+); shorts18 is matched first so it isn't shadowed by the shorts branch.
  return /^u_[^/]+\/(?:shorts18|shorts)\//.test(key);
}

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

// Drop folders need to be writable by whoever places files there (e.g. a Samba
// user that differs from the container uid), so the leaf import dirs are opened
// up. Best effort — a chmod failure must not break provisioning.
function makeDroppable(dir: string) {
  try {
    fs.chmodSync(dir, 0o777);
  } catch {
    /* best effort */
  }
}

// Pre-create a user's per-user home up front (instead of lazily on first upload),
// so every account has the same browsable layout from day one:
//   <PROFILE_ROOT>/<userHome>/{gallery,posts,shorts,shorts18,cookies}/  (served)
//   <IMPORT_ROOT>/<userHome>/{gallery,posts,shorts,shorts18,books}/     (drop tree)
// The import leaf dirs are world-writable so a Samba/other-uid user can drop files
// (the container runs as a different uid). Idempotent. Returns the userHome name.
export function ensureUserHome(
  userId: number,
  username?: string | null
): string {
  const home = userHomeDir(userId, username);
  for (const sec of PROFILE_SECTIONS) {
    ensureDir(path.join(PROFILE_ROOT, home, sec));
  }
  for (const sec of IMPORT_SECTIONS) {
    const dir = path.join(IMPORT_ROOT, home, sec);
    ensureDir(dir);
    makeDroppable(dir);
  }
  return home;
}

export function videoPathFor(channel: ShortChannel, storageKey: string): string {
  return isUploadKey(storageKey)
    ? path.join(PROFILE_ROOT, storageKey)
    : path.join(channelDir(channel), storageKey);
}

export function posterPathFor(
  channel: ShortChannel,
  posterKey: string
): string {
  return isUploadKey(posterKey)
    ? path.join(PROFILE_ROOT, posterKey)
    : path.join(channelDir(channel), posterKey);
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

// Fallback subfolder so a stored clip is NEVER loose in the channel root: an
// upload whose filename carries no "profilname_-_title" creator token lands here
// instead of directly under shorts/<channel>/.
const UPLOADS_FALLBACK_DIR = "uploads";

// Split a filename into [stem, ext] (ext INCLUDING the dot), treating ".web.mp4"
// as a single extension so an already-transcoded clip keeps a readable stem and
// its full extension.
function splitExt(name: string): [string, string] {
  if (name.toLowerCase().endsWith(".web.mp4")) {
    return [name.slice(0, -".web.mp4".length), ".web.mp4"];
  }
  const ext = path.extname(name);
  return [name.slice(0, name.length - ext.length), ext];
}

// Filesystem-safe single path segment: strips only path-breaking / control
// characters and keeps letters, digits, spaces and "_" / "-" so the old
// "profilname_-_title" naming survives (the "_-_" separator must not be lost).
function sanitizeSegment(s: string | null | undefined): string {
  return String(s || "")
    .replace(/[/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

// The creator name in a "profilname_-_title" (or "profilname - title") filename,
// so an upload lands in that creator's subfolder like the old elite layout.
// Returns null when there's no such separator — the caller then uses the
// fallback dir so the clip is still never stored loose.
export function profileFromFilename(filename: string): string | null {
  const [stem] = splitExt(filename);
  const m = stem.match(/^(\S.+?)(?:_-_|\s-\s)/);
  const name = m ? m[1].trim() : "";
  return name || null;
}

// READABLE base name for the stored file: the original filename's stem (so a
// "profilname_-_title" name is preserved exactly, per user request), falling
// back to the caption, then "clip". No random suffix here — storeShortUpload
// only appends one on a real name collision.
function readableBase(filename: string, caption: string | null): string {
  const [stem] = splitExt(filename);
  return sanitizeSegment(stem) || sanitizeSegment(caption) || "clip";
}

// Persist an uploaded short into the uploader's per-user home:
// <PROFILE_ROOT>/<userHome>/shorts/<channel>/<readableName>. Probes it for
// dimensions/duration and extracts a poster. Throws if the file isn't a
// supported video so the caller can reject the upload. `userHome` is the value
// from userHomeDir() (e.g. "u_anna"); the stored filename is the ORIGINAL
// upload name (so a "profilname_-_title" name is preserved), with a short suffix
// added only on a real name collision. The clip is ALWAYS placed in a subfolder
// (<channel>/<subdir>/<file>): the given `subdir` (import collection / creator
// parsed from the filename) or, when omitted, a shared fallback dir — never
// loose in the channel root.
export async function storeShortUpload(
  channel: ShortChannel,
  userHome: string,
  caption: string | null,
  filename: string,
  mime: string,
  // Buffer (interactive uploads) or a path to a file already on disk (the
  // folder importers) — the path form copies without buffering a multi-GB
  // video through the Next process.
  source: Buffer | string,
  subdir?: string | null
): Promise<StoredShort> {
  if (!isSupportedVideo(filename, mime)) {
    throw new Error("Unsupported file type — videos only");
  }

  // Per-user channel section: main -> "shorts", 18+ -> "shorts18".
  const section = channel === "18plus" ? "shorts18" : "shorts";
  // Mandatory subfolder — a clip is NEVER stored loose in the section root.
  // Either an explicit subdir (import collection / creator parsed from the
  // filename) or the shared fallback dir.
  const sub = profileSlug(subdir || UPLOADS_FALLBACK_DIR);
  const rel = `${userHome}/${section}/${sub}`; // relative to PROFILE_ROOT
  const dir = path.join(PROFILE_ROOT, rel);
  ensureDir(dir);

  const [, ext] = splitExt(filename); // ext includes the dot (".mp4"/".web.mp4")
  // Keep the original readable name; only on a real collision add a short suffix
  // so two clips never clobber each other (avoids the old clip_<uuid> noise).
  const wanted = readableBase(filename, caption);
  const base = fs.existsSync(path.join(dir, `${wanted}${ext}`))
    ? `${wanted}_${randomUUID().slice(0, 8)}`
    : wanted;
  // Self-describing upload key → videoPathFor()/posterPathFor() resolve it under
  // PROFILE_ROOT automatically.
  const storageKey = `${rel}/${base}${ext}`;
  const videoPath = path.join(PROFILE_ROOT, storageKey);
  if (typeof source === "string") fs.copyFileSync(source, videoPath);
  else fs.writeFileSync(videoPath, source);

  const meta = readVideoMeta(videoPath);

  // Best-effort poster. A failure here shouldn't fail the upload — the feed
  // falls back to the <video> element's own first frame.
  let posterKey: string | null = null;
  try {
    const posterBuf = extractVideoPoster(videoPath);
    posterKey = `${rel}/${base}.jpg`;
    await sharp(posterBuf)
      .resize(POSTER_MAX, POSTER_MAX, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 78 })
      .toFile(path.join(PROFILE_ROOT, posterKey));
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
    sizeBytes:
      typeof source === "string" ? fs.statSync(videoPath).size : source.length,
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

export interface MovedShortKeys {
  storageKey: string;
  posterKey: string | null;
}

// Reassign a clip to another profile by moving its files into that profile's
// folder (clips live under <channel>/<slug>/). Keeps the basenames, only the
// folder changes, so the video/poster routes resolve the new keys unchanged.
// Returns the updated keys; the caller persists them with the new profile_id.
// On a filename collision in the destination a short suffix is added so two
// clips never clobber each other.
export function moveShortToProfile(
  channel: ShortChannel,
  storageKey: string,
  posterKey: string | null,
  newProfileName: string
): MovedShortKeys {
  const slug = profileSlug(newProfileName);
  const destDir = path.join(channelDir(channel), slug);
  ensureDir(destDir);

  const moveOne = (key: string): string => {
    // Resolve from wherever the file currently lives (an upload under
    // PROFILE_ROOT, or a creator clip under SHORTS_ROOT); the destination is
    // always the shared creator-profile folder, so the returned key drops the
    // upload prefix and resolves under SHORTS_ROOT afterwards.
    const src = videoPathFor(channel, key);
    let base = path.basename(key);
    let dest = path.join(destDir, base);
    // Avoid overwriting an existing file from another clip in the same profile.
    if (fs.existsSync(dest) && path.resolve(src) !== path.resolve(dest)) {
      const ext = base.toLowerCase().endsWith(".web.mp4")
        ? ".web.mp4"
        : path.extname(base);
      const stem = base.slice(0, base.length - ext.length);
      base = `${stem}_${randomUUID().slice(0, 8)}${ext}`;
      dest = path.join(destDir, base);
    }
    // rename(2) fails with EXDEV when the clip moves between bind mounts (a
    // user upload under PROFILE_ROOT → the shared SHORTS_ROOT profile folder,
    // separate volumes in production) — fall back to copy + unlink.
    try {
      fs.renameSync(src, dest);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
      fs.copyFileSync(src, dest);
      fs.unlinkSync(src);
    }
    return `${slug}/${base}`;
  };

  const newStorageKey = moveOne(storageKey);
  let newPosterKey: string | null = null;
  if (posterKey) {
    try {
      newPosterKey = moveOne(posterKey);
    } catch {
      // Poster missing or unmovable: drop the reference rather than fail the
      // whole reassign — the transcoder can backfill a poster later.
      newPosterKey = null;
    }
  }

  return { storageKey: newStorageKey, posterKey: newPosterKey };
}

// Rename a freshly stored short's files to a canonical, self-describing basename
// — "<title> [h_tag]...[f_collection][id_<shortId>]" — within the SAME folder, so
// the stored file round-trips through the importer (re-dropping it re-parses to
// the same metadata and its [id_] triggers dedup). The video keeps its extension;
// the poster becomes "<stem>.jpg". `newStem` is assembled by the caller (already
// length-capped); here we only strip path-breaking characters. Returns the
// updated keys; the caller persists them. A real collision gets a short suffix.
export function renameShortFiles(
  channel: ShortChannel,
  storageKey: string,
  posterKey: string | null,
  newStem: string
): MovedShortKeys {
  const [, ext] = splitExt(path.basename(storageKey));
  const dir = path.dirname(storageKey); // unchanged; relative to PROFILE_ROOT
  const safe =
    newStem.replace(/[/:*?"<>|\x00-\x1f]+/g, " ").replace(/\s+/g, " ").trim() ||
    "clip";

  const keyFor = (stem: string, e: string) =>
    dir === "." ? `${stem}${e}` : `${dir}/${stem}${e}`;

  // Decide the final stem once (off the video) so video + poster stay paired.
  const srcVideo = videoPathFor(channel, storageKey);
  let finalStem = safe;
  const probe = videoPathFor(channel, keyFor(safe, ext));
  if (fs.existsSync(probe) && path.resolve(srcVideo) !== path.resolve(probe)) {
    finalStem = `${safe}_${randomUUID().slice(0, 8)}`;
  }

  const newStorageKey = keyFor(finalStem, ext);
  fs.renameSync(srcVideo, videoPathFor(channel, newStorageKey));

  let newPosterKey: string | null = null;
  if (posterKey) {
    try {
      newPosterKey = keyFor(finalStem, ".jpg");
      fs.renameSync(posterPathFor(channel, posterKey), posterPathFor(channel, newPosterKey));
    } catch {
      newPosterKey = null;
    }
  }
  return { storageKey: newStorageKey, posterKey: newPosterKey };
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
