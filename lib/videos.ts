import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { db } from "./db";
import type { VideoRow, VideoChannel } from "./db";
import { has18Access } from "./shorts-gate";
import {
  VIDEO_CHANNELS,
  artworkStem,
  canRemuxToMp4,
  channelAvailable,
  channelDir,
  isTranscodeTemp,
  isWebPlayable,
  ensureVideoDirs,
  posterFilePath,
  videoFilePath,
  walkChannel,
} from "./videos-storage";
import { applyNfo } from "./video-metadata";

export type { VideoChannel } from "./db";

export interface VideoWithState extends VideoRow {
  position: number;
  percent: number;
  finished_at: string | null;
  watched_at: string | null;
  likes: number;
  liked: number;
}

// The 18+ channel follows the same rule as 18+ shorts: open to every logged-in
// user unless they set a personal PIN, in which case an unlock is required.
// Every route re-checks this itself — nothing trusts an upstream gate.
export async function canAccessVideoChannel(
  channel: VideoChannel
): Promise<boolean> {
  if (channel === "main") return true;
  return has18Access();
}

// ---------------------------------------------------------------------------
// Media probing / artwork
//
// Everything here shells out to ffmpeg/ffprobe ASYNCHRONOUSLY. A scan of a real
// library is minutes of child processes; doing that with execFileSync would
// block the Node event loop and freeze the whole app while it ran.
// ---------------------------------------------------------------------------

const execFile = promisify(execFileCb);

// ffmpeg work is niced so a scan or transcode never starves the web app.
async function run(
  bin: string,
  args: string[],
  timeoutMs: number
): Promise<void> {
  await execFile("nice", ["-n", "19", bin, ...args], {
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
}

type Probe = {
  duration: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
};

const EMPTY_PROBE: Probe = {
  duration: null,
  width: null,
  height: null,
  videoCodec: null,
  audioCodec: null,
};

async function probeVideo(filePath: string): Promise<Probe> {
  const probe: Probe = { ...EMPTY_PROBE };
  try {
    const { stdout } = await execFile(
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
      { maxBuffer: 16 * 1024 * 1024, timeout: 120_000 }
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = JSON.parse(stdout);
    const duration = Number(data.format?.duration);
    if (Number.isFinite(duration) && duration > 0) probe.duration = duration;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const streams: any[] = data.streams || [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = streams.find((s: any) => s.codec_type === "video");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = streams.find((s: any) => s.codec_type === "audio");
    if (a?.codec_name) probe.audioCodec = String(a.codec_name).toLowerCase();
    if (v) {
      if (v.codec_name) probe.videoCodec = String(v.codec_name).toLowerCase();
      if (typeof v.width === "number") probe.width = v.width;
      if (typeof v.height === "number") probe.height = v.height;
      const rot = Math.abs(
        Number(v.tags?.rotate ?? v.side_data_list?.[0]?.rotation ?? 0)
      );
      if ((rot === 90 || rot === 270) && probe.width && probe.height) {
        [probe.width, probe.height] = [probe.height, probe.width];
      }
      if (probe.duration === null) {
        // Matroska often carries no container duration; fall back to the stream
        // and then to its DURATION tag before giving up.
        const streamDuration = Number(v.duration);
        if (Number.isFinite(streamDuration) && streamDuration > 0) {
          probe.duration = streamDuration;
        } else if (typeof v.tags?.DURATION === "string") {
          const m = /(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(v.tags.DURATION);
          if (m) {
            probe.duration =
              Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
          }
        }
      }
    }
  } catch {
    /* ffprobe missing or unreadable file — the row just stays without meta */
  }
  return probe;
}

// Poster frame, taken ~10% in (past title cards / black intros), scaled to a
// 640px-wide grid thumbnail. Returns the poster filename or null. Input seeking
// (-ss before -i) makes this a keyframe jump rather than a decode from zero.
async function makePoster(
  filePath: string,
  stem: string,
  duration: number | null
): Promise<string | null> {
  const name = `${stem}.jpg`;
  const out = posterFilePath(name);
  const seek = duration && duration > 20 ? Math.floor(duration * 0.1) : 1;
  const attempt = async (at: number): Promise<boolean> => {
    try {
      await run(
        "ffmpeg",
        [
          "-y",
          "-hide_banner",
          "-loglevel",
          "error",
          "-nostdin",
          "-ss",
          String(at),
          "-i",
          filePath,
          "-frames:v",
          "1",
          "-vf",
          "scale=640:-2",
          "-q:v",
          "3",
          out,
        ],
        120_000
      );
    } catch {
      /* checked via the output file below */
    }
    return fs.existsSync(out) && fs.statSync(out).size > 0;
  };
  for (const at of [seek, 1, 0]) {
    if (await attempt(at)) return name;
  }
  return null;
}

export type Storyboard = {
  key: string;
  cols: number;
  rows: number;
  interval: number;
  tileW: number;
  tileH: number;
};

// Scrub-preview storyboard: a single JPEG tiling cols*rows evenly-spaced frames,
// which the player slices with background-position while dragging the seek bar
// (one request instead of hundreds of thumbnails).
//
// Each frame is grabbed with its own input seek and the sheet is assembled from
// the results. The obvious one-liner — fps=1/interval + tile — decodes the WHOLE
// file, which is minutes per feature-length video; seeking is near-instant.
async function makeStoryboard(
  filePath: string,
  stem: string,
  duration: number | null,
  height: number | null,
  width: number | null
): Promise<Storyboard | null> {
  if (!duration || duration < 30) return null;
  const cols = 10;
  const rows = duration < 300 ? 5 : 10;
  const frames = cols * rows;
  const interval = duration / frames;
  const tileW = 160;
  // Keep the source aspect so the preview isn't letterboxed; default 16:9.
  const aspect = width && height ? width / height : 16 / 9;
  const tileH = Math.max(2, Math.round(tileW / aspect / 2) * 2);
  const name = `${stem}_sb.jpg`;
  const out = posterFilePath(name);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "video-sb-"));
  try {
    let lastGood: string | null = null;
    for (let i = 0; i < frames; i++) {
      const at = Math.min(i * interval, Math.max(0, duration - 0.5));
      const frame = path.join(tmpDir, `f${String(i).padStart(4, "0")}.jpg`);
      try {
        await run(
          "ffmpeg",
          [
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-ss",
            at.toFixed(3),
            "-i",
            filePath,
            "-frames:v",
            "1",
            "-vf",
            `scale=${tileW}:${tileH}`,
            "-q:v",
            "6",
            frame,
          ],
          60_000
        );
      } catch {
        /* handled by the gap fill below */
      }
      if (fs.existsSync(frame) && fs.statSync(frame).size > 0) {
        lastGood = frame;
      } else if (lastGood) {
        // The image-sequence demuxer stops at the first missing index, so a
        // frame ffmpeg couldn't grab is filled with the previous one.
        fs.copyFileSync(lastGood, frame);
      } else {
        return null; // nothing decodable at all
      }
    }

    await run(
      "ffmpeg",
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-framerate",
        "1",
        "-start_number",
        "0",
        "-i",
        path.join(tmpDir, "f%04d.jpg"),
        "-vf",
        `tile=${cols}x${rows}`,
        "-frames:v",
        "1",
        "-q:v",
        "6",
        out,
      ],
      120_000
    );
  } catch {
    /* checked via the output file below */
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }

  if (!fs.existsSync(out) || fs.statSync(out).size === 0) return null;
  return { key: name, cols, rows, interval, tileW, tileH };
}

// Human title from a filename: drop the extension, turn separators into spaces
// and strip the usual release noise, so "Some.Doc.2021.1080p.WEB-DL.x264.mkv"
// reads as "Some Doc 2021".
const NOISE =
  /\b(1080p|2160p|720p|480p|4k|uhd|hdr|web-?dl|webrip|bluray|brrip|dvdrip|hdrip|x264|x265|h264|h265|hevc|aac|ac3|dts|ddp?5[._ ]1|xvid|remux|proper|repack|extended|amzn|nf|hmax|dsnp)\b/gi;

export function titleFromFilename(filename: string): string {
  const stem = path.basename(filename, path.extname(filename));
  const cleaned = stem
    .replace(/[._]+/g, " ")
    .replace(NOISE, " ")
    .replace(/[[({][^\])}]*[\])}]/g, " ")
    .replace(/\s*-\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || stem || "Untitled";
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

export interface ScanResult {
  channel: VideoChannel;
  added: number;
  updated: number;
  removed: number;
  artwork: number;
  needTranscode: number;
  skipped: boolean;
  message: string;
}

// One scan per channel at a time. A scan is long (ffmpeg per file) and a second
// concurrent pass would race the same rows and regenerate the same artwork —
// the admin button and the hourly job can easily overlap on a big library.
const scanning = new Set<VideoChannel>();

export function isScanning(channel?: VideoChannel): boolean {
  return channel ? scanning.has(channel) : scanning.size > 0;
}

// Mirror one channel directory into the DB. New files are inserted (with a
// probe + poster + storyboard), files whose size/mtime changed are re-probed,
// and rows whose file is gone are deleted — but ONLY when the mount looks
// healthy, so an unmounted volume can never wipe the library.
export async function scanVideoChannel(
  channel: VideoChannel
): Promise<ScanResult> {
  ensureVideoDirs();
  const result: ScanResult = {
    channel,
    added: 0,
    updated: 0,
    removed: 0,
    artwork: 0,
    needTranscode: 0,
    skipped: false,
    message: "",
  };

  if (scanning.has(channel)) {
    result.skipped = true;
    result.message = `A scan of "${channel}" is already running.`;
    return result;
  }
  scanning.add(channel);

  try {
    const files = walkChannel(channel);
    const existing = db
      .prepare("SELECT * FROM videos WHERE channel = ?")
      .all(channel) as VideoRow[];
    const byKey = new Map(existing.map((row) => [row.storage_key, row]));

    const insert = db.prepare(
      `INSERT INTO videos (channel, storage_key, folder, title, poster_key,
         storyboard_key, storyboard_cols, storyboard_rows, storyboard_interval,
         storyboard_tile_w, storyboard_tile_h, duration, width, height,
         size_bytes, file_mtime, video_codec, audio_codec, playable,
         transcode_status)
       VALUES (@channel, @storage_key, @folder, @title, @poster_key,
         @storyboard_key, @storyboard_cols, @storyboard_rows, @storyboard_interval,
         @storyboard_tile_w, @storyboard_tile_h, @duration, @width, @height,
         @size_bytes, @file_mtime, @video_codec, @audio_codec, @playable,
         @transcode_status)`
    );
    const updateMeta = db.prepare(
      `UPDATE videos SET folder = @folder, duration = @duration, width = @width,
         height = @height, size_bytes = @size_bytes, file_mtime = @file_mtime,
         poster_key = @poster_key, storyboard_key = @storyboard_key,
         storyboard_cols = @storyboard_cols, storyboard_rows = @storyboard_rows,
         storyboard_interval = @storyboard_interval,
         storyboard_tile_w = @storyboard_tile_w,
         storyboard_tile_h = @storyboard_tile_h,
         video_codec = @video_codec, audio_codec = @audio_codec,
         playable = @playable, transcode_status = @transcode_status
       WHERE id = @id`
    );

    for (const file of files) {
      if (isBeingConverted(channel, file.storageKey)) {
        byKey.delete(file.storageKey); // in flight, not missing: keep its row
        continue;
      }
      const row = byKey.get(file.storageKey);
      const filePath = videoFilePath(channel, file.storageKey);
      const stem = artworkStem(channel, file.storageKey);

      if (!row) {
        const probe = await probeVideo(filePath);
        const playable = isWebPlayable(
          file.storageKey,
          probe.videoCodec,
          probe.audioCodec
        );
        const poster = await makePoster(filePath, stem, probe.duration);
        // No storyboard for a file that is about to be rewritten: the transcode
        // changes the storage key (and therefore the artwork names), so the
        // work would be thrown away. The post-transcode scan builds it.
        const sb = playable
          ? await makeStoryboard(
              filePath,
              stem,
              probe.duration,
              probe.height,
              probe.width
            )
          : null;
        const info = insert.run({
          channel,
          storage_key: file.storageKey,
          folder: file.folder,
          title: titleFromFilename(file.storageKey),
          poster_key: poster,
          storyboard_key: sb?.key ?? null,
          storyboard_cols: sb?.cols ?? null,
          storyboard_rows: sb?.rows ?? null,
          storyboard_interval: sb?.interval ?? null,
          storyboard_tile_w: sb?.tileW ?? null,
          storyboard_tile_h: sb?.tileH ?? null,
          duration: probe.duration,
          width: probe.width,
          height: probe.height,
          size_bytes: file.size,
          file_mtime: file.mtime,
          video_codec: probe.videoCodec,
          audio_codec: probe.audioCodec,
          playable: playable ? 1 : 0,
          transcode_status: playable ? null : "pending",
        });
        result.added++;
        if (poster) result.artwork++;
        if (!playable) result.needTranscode++;
        // A .nfo sidecar next to the file is authoritative and free to read, so
        // a Whisparr-style drop is fully described the moment it is scanned —
        // no waiting for the metadata pass, no third-party call.
        if (channel === "adults") {
          const inserted = getVideo(Number(info.lastInsertRowid));
          if (inserted) {
            try {
              await applyNfo(inserted);
            } catch {
              /* metadata is best-effort; the matcher retries later */
            }
          }
        }
        continue;
      }

      byKey.delete(file.storageKey);

      // Re-probe only when the file actually changed, or when a previous scan
      // failed to produce artwork (e.g. ffmpeg was busy / the file was still
      // being copied). Rows the user edited keep their title/description.
      const changed =
        row.size_bytes !== file.size || row.file_mtime !== file.mtime;
      const posterMissing =
        !row.poster_key || !fs.existsSync(posterFilePath(row.poster_key));
      if (!changed && !posterMissing) continue;

      const probe = changed
        ? await probeVideo(filePath)
        : {
            duration: row.duration,
            width: row.width,
            height: row.height,
            videoCodec: row.video_codec,
            audioCodec: row.audio_codec,
          };
      const playable = isWebPlayable(
        file.storageKey,
        probe.videoCodec,
        probe.audioCodec
      );
      const poster =
        changed || posterMissing
          ? await makePoster(filePath, stem, probe.duration)
          : row.poster_key;
      const sb =
        playable && (changed || !row.storyboard_key)
          ? await makeStoryboard(
              filePath,
              stem,
              probe.duration,
              probe.height,
              probe.width
            )
          : null;
      updateMeta.run({
        id: row.id,
        folder: file.folder,
        duration: probe.duration,
        width: probe.width,
        height: probe.height,
        size_bytes: file.size,
        file_mtime: file.mtime,
        poster_key: poster,
        storyboard_key: sb?.key ?? row.storyboard_key,
        storyboard_cols: sb?.cols ?? row.storyboard_cols,
        storyboard_rows: sb?.rows ?? row.storyboard_rows,
        storyboard_interval: sb?.interval ?? row.storyboard_interval,
        storyboard_tile_w: sb?.tileW ?? row.storyboard_tile_w,
        storyboard_tile_h: sb?.tileH ?? row.storyboard_tile_h,
        video_codec: probe.videoCodec,
        audio_codec: probe.audioCodec,
        playable: playable ? 1 : 0,
        // Never re-queue a file that already failed conversion; a changed file
        // gets a fresh chance.
        transcode_status: playable
          ? null
          : changed
            ? "pending"
            : (row.transcode_status ?? "pending"),
      });
      result.updated++;
      if (poster && poster !== row.poster_key) result.artwork++;
      if (!playable) result.needTranscode++;
    }

    // Anything still in byKey has no file on disk. Pruning is only safe when the
    // media mount is clearly present: either this channel still has files, or the
    // OTHER channel does (so an emptied channel can legitimately drop to zero).
    // If the whole root reads empty, treat it as an unmounted volume and keep the
    // rows — otherwise one failed mount would wipe the entire library.
    if (byKey.size > 0) {
      const mountLooksHealthy =
        files.length > 0 ||
        VIDEO_CHANNELS.some((c) => c !== channel && channelAvailable(c));
      if (!mountLooksHealthy) {
        result.skipped = true;
        result.message = `No video files found under VIDEOS_ROOT — the volume looks unmounted, so ${byKey.size} row(s) were kept instead of deleted.`;
      } else {
        const del = db.prepare("DELETE FROM videos WHERE id = ?");
        for (const row of byKey.values()) {
          if (isBeingConverted(channel, row.storage_key)) continue;
          del.run(row.id);
          deleteArtwork(row);
          result.removed++;
        }
      }
    }

    if (!result.message) {
      result.message =
        `${result.added} added, ${result.updated} updated, ${result.removed} removed.` +
        (result.needTranscode
          ? ` ${result.needTranscode} need converting before they can play.`
          : "");
    }
    return result;
  } finally {
    scanning.delete(channel);
  }
}

export async function scanAllVideos(): Promise<ScanResult[]> {
  const results: ScanResult[] = [];
  for (const channel of VIDEO_CHANNELS) {
    results.push(await scanVideoChannel(channel));
  }
  return results;
}

function deleteArtwork(row: Pick<VideoRow, "poster_key" | "storyboard_key">) {
  for (const key of [row.poster_key, row.storyboard_key]) {
    if (!key) continue;
    try {
      fs.rmSync(posterFilePath(key), { force: true });
    } catch {
      /* best effort */
    }
  }
}

// ---------------------------------------------------------------------------
// Transcoding
//
// Anything a browser can't play (DVD rips, HEVC, AC-3 audio, an .avi container)
// is converted to H.264/AAC in MP4. Where only the container is wrong the
// streams are copied, which takes seconds; otherwise it is a real encode, which
// on a Pi runs at roughly 3-4x realtime for SD material.
// ---------------------------------------------------------------------------

export interface TranscodeResult {
  converted: number;
  failed: number;
  remaining: number;
  message: string;
}

let transcoding = false;
// The two keys a conversion is about to swap: its source is deleted at the end
// and its output appears in the same instant. A scan must leave BOTH alone —
// reading the source inserts a row for a file that is about to vanish, and the
// half-written output would be filed as a video of its own. Everything else in
// the library is untouched by a conversion, so the scan no longer has to wait
// for one; a conversion runs for hours, and a file dropped in meanwhile would
// stay invisible for all of them.
let converting: { channel: VideoChannel; srcKey: string; dstKey: string } | null =
  null;

function isBeingConverted(channel: VideoChannel, storageKey: string): boolean {
  return (
    converting !== null &&
    converting.channel === channel &&
    (converting.srcKey === storageKey || converting.dstKey === storageKey)
  );
}

export interface TranscodeRunSummary {
  finishedAt: string;
  converted: number;
  failed: number;
  message: string;
}

let lastRun: TranscodeRunSummary | null = null;

export function isTranscoding(): boolean {
  return transcoding;
}

// `channel` scopes the count to one library, so a badge cannot promise a
// backlog that the list under it does not show.
export function transcodeState(channel?: VideoChannel): {
  running: boolean;
  pending: number;
  lastRun: TranscodeRunSummary | null;
  // Which file is being rewritten right now, so the queue list can say so
  // instead of leaving every row looking equally idle.
  currentKey: string | null;
} {
  return {
    running: transcoding,
    pending: pendingTranscodes(channel),
    lastRun,
    currentKey: converting?.srcKey ?? null,
  };
}

export interface TranscodeQueueItem {
  id: number;
  channel: VideoChannel;
  title: string;
  folder: string | null;
  storage_key: string;
  size_bytes: number;
  duration: number | null;
  video_codec: string | null;
  audio_codec: string | null;
  transcode_status: string | null;
  transcode_error: string | null;
}

// Everything a browser cannot play, smallest first — the same order the queue
// run works in, so the list doubles as "what happens next". Includes the ones
// that already failed: they are exactly the files worth retrying by hand.
export function transcodeQueue(channel?: VideoChannel): TranscodeQueueItem[] {
  return db
    .prepare(
      `SELECT id, channel, title, folder, storage_key, size_bytes, duration,
              video_codec, audio_codec, transcode_status, transcode_error
         FROM videos
        WHERE playable = 0${channel ? " AND channel = @channel" : ""}
        ORDER BY (transcode_status = 'failed') ASC, size_bytes ASC`
    )
    .all(channel ? { channel } : {}) as TranscodeQueueItem[];
}

// Kick off a queue run WITHOUT waiting for it. A conversion is minutes to hours;
// holding the HTTP request open that long fails regardless of route config,
// because the fetch client gives up first (undici drops a response with no
// headers after 5 minutes — the scheduler's job died there while ffmpeg kept
// going). Callers poll transcodeState() instead.
export function startTranscodeRun(budgetMs?: number): {
  started: boolean;
  message: string;
  pending: number;
} {
  if (transcoding) {
    return {
      started: false,
      message: "A conversion run is already in progress.",
      pending: pendingTranscodes(),
    };
  }
  if (isScanning()) {
    return {
      started: false,
      message: "A library scan is in progress — try again once it finishes.",
      pending: pendingTranscodes(),
    };
  }
  const pending = pendingTranscodes();
  if (pending === 0) {
    return { started: false, message: "Nothing to convert.", pending: 0 };
  }
  // The synchronous prefix of transcodePendingVideos sets the lock before it
  // awaits anything, so a second call lands on the guard above.
  void transcodePendingVideos(budgetMs)
    .then((r) => {
      lastRun = {
        finishedAt: new Date().toISOString(),
        converted: r.converted,
        failed: r.failed,
        message: r.message,
      };
    })
    .catch((err) => {
      lastRun = {
        finishedAt: new Date().toISOString(),
        converted: 0,
        failed: 0,
        message: `Run aborted: ${String((err as Error)?.message || err)}`,
      };
    });
  return {
    started: true,
    message: `Converting ${pending} video${pending === 1 ? "" : "s"} in the background.`,
    pending,
  };
}

// Same, for a single video (the per-video Convert button).
export function startTranscodeOne(id: number): {
  started: boolean;
  message: string;
} {
  if (transcoding) {
    return { started: false, message: "A conversion run is already in progress." };
  }
  if (isScanning()) {
    return {
      started: false,
      message: "A library scan is in progress — try again once it finishes.",
    };
  }
  void transcodeOne(id)
    .then((r) => {
      lastRun = {
        finishedAt: new Date().toISOString(),
        converted: r.converted,
        failed: r.failed,
        message: r.message,
      };
    })
    .catch((err) => {
      lastRun = {
        finishedAt: new Date().toISOString(),
        converted: 0,
        failed: 1,
        message: String((err as Error)?.message || err),
      };
    });
  return { started: true, message: "Converting in the background." };
}

export function pendingTranscodes(channel?: VideoChannel): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM videos
        WHERE playable = 0
          AND (transcode_status IS NULL OR transcode_status = 'pending')
          ${channel ? "AND channel = @channel" : ""}`
    )
    .get(channel ? { channel } : {}) as { n: number };
  return row.n;
}

// Remove orphaned "<name>.converting.mp4" files across both channels.
function sweepTranscodeTemps(): number {
  let removed = 0;
  for (const channel of VIDEO_CHANNELS) {
    const root = channelDir(channel);
    const walk = (dir: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && isTranscodeTemp(entry.name)) {
          try {
            fs.rmSync(full, { force: true });
            removed++;
          } catch {
            /* best effort */
          }
        }
      }
    };
    walk(root);
  }
  return removed;
}

async function convertOne(row: VideoRow): Promise<void> {
  const src = videoFilePath(row.channel, row.storage_key);
  if (!fs.existsSync(src)) throw new Error("source file is gone");

  // Same folder, same basename, .mp4 — so the library keeps its structure and
  // the file stays where its owner put it.
  const dstKey = `${row.storage_key.replace(/\.[^./]+$/, "")}.mp4`;
  if (dstKey === row.storage_key) throw new Error("source is already .mp4");
  const dst = videoFilePath(row.channel, dstKey);
  const tmp = `${dst}.converting.mp4`;
  fs.rmSync(tmp, { force: true });
  converting = { channel: row.channel, srcKey: row.storage_key, dstKey };

  const remuxable = canRemuxToMp4(row.video_codec, row.audio_codec);
  const base = ["-y", "-hide_banner", "-loglevel", "error", "-nostdin", "-i", src];
  // Long encodes need a generous ceiling: a 45-minute SD film is ~15 minutes.
  const budgetMs = Math.max(
    30 * 60_000,
    Math.ceil(((row.duration ?? 3600) / 2) * 1000)
  );

  if (remuxable) {
    await run("ffmpeg", [...base, "-c", "copy", "-movflags", "+faststart", tmp], 30 * 60_000);
  } else {
    await run(
      "ffmpeg",
      [
        ...base,
        "-c:v",
        "libx264",
        "-profile:v",
        "main",
        // Force 8-bit. ffmpeg otherwise carries the source's pixel format
        // through, and a 10-bit source then fails outright ("main profile
        // doesn't support a bit depth of 10") — while High 10, the profile
        // that would accept it, is not decodable by most browsers anyway.
        "-pix_fmt",
        "yuv420p",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        // Cap at 1080p — anything larger is wasted on this library and slow.
        "-vf",
        "scale='min(1920,iw)':-2",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-ac",
        "2",
        // Two threads leaves the Pi cores for the app while a long encode runs.
        "-threads",
        "2",
        "-movflags",
        "+faststart",
        tmp,
      ],
      budgetMs
    );
  }

  if (!fs.existsSync(tmp) || fs.statSync(tmp).size === 0) {
    throw new Error("ffmpeg produced no output");
  }

  // Verify before anything is deleted: the result must be playable and must
  // cover the source's running time (a truncated encode is the failure mode
  // that would otherwise silently destroy the original).
  const probe = await probeVideo(tmp);
  if (!isWebPlayable(dstKey, probe.videoCodec, probe.audioCodec)) {
    throw new Error(
      `converted file is still not web-playable (${probe.videoCodec}/${probe.audioCodec})`
    );
  }
  if (row.duration && probe.duration && probe.duration < row.duration * 0.98) {
    throw new Error(
      `converted file is short: ${Math.round(probe.duration)}s vs ${Math.round(row.duration)}s`
    );
  }

  fs.renameSync(tmp, dst);

  // Artwork is named from the storage key, so the old sheet/poster belong to a
  // key that no longer exists — drop them and build fresh ones from the MP4.
  deleteArtwork(row);
  const stem = artworkStem(row.channel, dstKey);
  const poster = await makePoster(dst, stem, probe.duration);
  const sb = await makeStoryboard(
    dst,
    stem,
    probe.duration,
    probe.height,
    probe.width
  );

  db.prepare(
    `UPDATE videos SET storage_key = @storage_key, duration = @duration,
       width = @width, height = @height, size_bytes = @size_bytes,
       file_mtime = @file_mtime, video_codec = @video_codec,
       audio_codec = @audio_codec, playable = 1, transcode_status = 'done',
       transcode_error = NULL, poster_key = @poster_key,
       storyboard_key = @storyboard_key, storyboard_cols = @storyboard_cols,
       storyboard_rows = @storyboard_rows,
       storyboard_interval = @storyboard_interval,
       storyboard_tile_w = @storyboard_tile_w,
       storyboard_tile_h = @storyboard_tile_h
     WHERE id = @id`
  ).run({
    id: row.id,
    storage_key: dstKey,
    duration: probe.duration,
    width: probe.width,
    height: probe.height,
    size_bytes: fs.statSync(dst).size,
    file_mtime: new Date(fs.statSync(dst).mtimeMs).toISOString(),
    video_codec: probe.videoCodec,
    audio_codec: probe.audioCodec,
    poster_key: poster,
    storyboard_key: sb?.key ?? null,
    storyboard_cols: sb?.cols ?? null,
    storyboard_rows: sb?.rows ?? null,
    storyboard_interval: sb?.interval ?? null,
    storyboard_tile_w: sb?.tileW ?? null,
    storyboard_tile_h: sb?.tileH ?? null,
  });

  // The row now points at the MP4, so the source is redundant. Removed only
  // after the checks above passed. Set VIDEOS_KEEP_ORIGINALS=1 to keep it (the
  // scan then re-adds it as its own unplayable row, so this is off by default).
  if (process.env.VIDEOS_KEEP_ORIGINALS !== "1") {
    fs.rmSync(src, { force: true });
  }
}

// Work the conversion queue until the time budget runs out, so an hourly job
// chews through a big library across several runs instead of hitting the
// scheduler's one-hour ceiling mid-file.
export async function transcodePendingVideos(
  budgetMs = 45 * 60_000
): Promise<TranscodeResult> {
  if (transcoding) {
    return {
      converted: 0,
      failed: 0,
      remaining: pendingTranscodes(),
      message: "A conversion run is already in progress.",
    };
  }
  if (isScanning()) {
    return {
      converted: 0,
      failed: 0,
      remaining: pendingTranscodes(),
      message: "A library scan is in progress — skipping this conversion run.",
    };
  }
  transcoding = true;
  // Nothing else writes these, and no conversion is running (both are checked
  // above), so anything left is from a run that was killed — a restart mid
  // encode, most often. Clear it before starting: the files are large, and a
  // scan would otherwise have to know to ignore them forever.
  sweepTranscodeTemps();
  const deadline = Date.now() + budgetMs;
  let converted = 0;
  let failed = 0;

  try {
    for (;;) {
      if (Date.now() >= deadline) break;
      const row = db
        .prepare(
          `SELECT * FROM videos
            WHERE playable = 0
              AND (transcode_status IS NULL OR transcode_status = 'pending')
            ORDER BY size_bytes ASC
            LIMIT 1`
        )
        .get() as VideoRow | undefined;
      if (!row) break;

      try {
        await convertOne(row);
        converted++;
      } catch (err) {
        failed++;
        // Keep the TAIL of the failure, not the head: ffmpeg's own reason
        // ("Permission denied", "Invalid data found") is the last line, while
        // the first 500 characters are the command line we already know.
        const message = String((err as Error)?.message || err).trim();
        db.prepare(
          "UPDATE videos SET transcode_status = 'failed', transcode_error = ? WHERE id = ?"
        ).run(message.slice(-500), row.id);
      } finally {
        // The swap is over either way: nothing is in flight between files.
        converting = null;
      }
    }
  } finally {
    transcoding = false;
  }

  const remaining = pendingTranscodes();
  return {
    converted,
    failed,
    remaining,
    message: `${converted} converted, ${failed} failed, ${remaining} still queued.`,
  };
}

// Put a failed conversion back in the queue (the Retry button).
export function requeueTranscode(id: number): void {
  db.prepare(
    "UPDATE videos SET transcode_status = 'pending', transcode_error = NULL WHERE id = ? AND playable = 0"
  ).run(id);
}

// Convert exactly one video. The per-video "Convert now" button uses this —
// running the whole queue from a single video's page would kick off hours of
// encoding nobody asked for.
export async function transcodeOne(id: number): Promise<TranscodeResult> {
  if (transcoding) {
    return {
      converted: 0,
      failed: 0,
      remaining: pendingTranscodes(),
      message: "A conversion run is already in progress.",
    };
  }
  if (isScanning()) {
    return {
      converted: 0,
      failed: 0,
      remaining: pendingTranscodes(),
      message: "A library scan is in progress — try again once it finishes.",
    };
  }
  const row = db.prepare("SELECT * FROM videos WHERE id = ?").get(id) as
    | VideoRow
    | undefined;
  if (!row || row.playable === 1) {
    return {
      converted: 0,
      failed: 0,
      remaining: pendingTranscodes(),
      message: "Nothing to convert for that video.",
    };
  }

  transcoding = true;
  try {
    await convertOne(row);
    return {
      converted: 1,
      failed: 0,
      remaining: pendingTranscodes(),
      message: "Converted.",
    };
  } catch (err) {
    const message = String((err as Error)?.message || err).slice(0, 500);
    db.prepare(
      "UPDATE videos SET transcode_status = 'failed', transcode_error = ? WHERE id = ?"
    ).run(message, row.id);
    return {
      converted: 0,
      failed: 1,
      remaining: pendingTranscodes(),
      message: `Conversion failed: ${message}`,
    };
  } finally {
    transcoding = false;
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export type VideoSort = "added" | "title" | "views" | "duration" | "oldest";

const WITH_STATE_SELECT = `
  SELECT v.*,
         COALESCE(p.position, 0) AS position,
         COALESCE(p.percent, 0) AS percent,
         p.finished_at AS finished_at,
         p.updated_at AS watched_at,
         (SELECT COUNT(*) FROM video_likes l WHERE l.video_id = v.id) AS likes,
         EXISTS(SELECT 1 FROM video_likes l
                 WHERE l.video_id = v.id AND l.user_id = @userId) AS liked
    FROM videos v
    LEFT JOIN video_progress p ON p.video_id = v.id AND p.user_id = @userId
`;

const ORDER_BY: Record<VideoSort, string> = {
  added: "v.added_at DESC, v.id DESC",
  oldest: "v.added_at ASC, v.id ASC",
  title: "v.title COLLATE NOCASE ASC",
  views: "v.views DESC, v.added_at DESC",
  duration: "v.duration DESC",
};

export function listVideos(opts: {
  channel: VideoChannel;
  userId: number;
  q?: string;
  folder?: string;
  sort?: VideoSort;
  limit?: number;
  offset?: number;
}): VideoWithState[] {
  const where: string[] = ["v.channel = @channel"];
  const params: Record<string, unknown> = {
    channel: opts.channel,
    userId: opts.userId,
    limit: Math.min(Math.max(opts.limit ?? 60, 1), 200),
    offset: Math.max(opts.offset ?? 0, 0),
  };
  const q = opts.q?.trim();
  if (q) {
    where.push(
      "(v.title LIKE @q OR v.description LIKE @q OR v.folder LIKE @q OR v.storage_key LIKE @q)"
    );
    params.q = `%${q}%`;
  }
  if (opts.folder !== undefined && opts.folder !== "") {
    where.push("(v.folder = @folder OR v.folder LIKE @folderPrefix)");
    params.folder = opts.folder;
    params.folderPrefix = `${opts.folder}/%`;
  }
  const sql = `${WITH_STATE_SELECT}
    WHERE ${where.join(" AND ")}
    ORDER BY ${ORDER_BY[opts.sort ?? "added"]}
    LIMIT @limit OFFSET @offset`;
  return db.prepare(sql).all(params) as VideoWithState[];
}

export function countVideos(channel: VideoChannel): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM videos WHERE channel = ?")
    .get(channel) as { n: number };
  return row.n;
}

// Partly-watched, unfinished videos — the "Continue watching" shelf.
export function continueWatching(
  channel: VideoChannel,
  userId: number,
  limit = 12
): VideoWithState[] {
  const sql = `${WITH_STATE_SELECT}
    WHERE v.channel = @channel
      AND p.position > 5
      AND p.finished_at IS NULL
      AND COALESCE(p.percent, 0) < 95
    ORDER BY p.updated_at DESC
    LIMIT @limit`;
  return db
    .prepare(sql)
    .all({ channel, userId, limit }) as VideoWithState[];
}

export function listFolders(
  channel: VideoChannel
): { folder: string; count: number }[] {
  // Group on the TOP-level segment only. A Whisparr layout nests one folder per
  // scene ("Watch Your Mom/Watch Your Mom - 2019-05-05 - … [WEBDL-400]"), which
  // would otherwise produce one unreadable chip per file. Filtering on the
  // segment still matches everything beneath it (see listVideos).
  const rows = db
    .prepare(
      `SELECT folder FROM videos WHERE channel = ? AND folder <> ''`
    )
    .all(channel) as { folder: string }[];
  const counts = new Map<string, number>();
  for (const { folder } of rows) {
    const top = folder.split("/")[0];
    counts.set(top, (counts.get(top) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([folder, count]) => ({ folder, count }))
    .sort((a, b) => a.folder.localeCompare(b.folder, undefined, { sensitivity: "base" }));
}

export function getVideo(id: number): VideoRow | undefined {
  return db.prepare("SELECT * FROM videos WHERE id = ?").get(id) as
    | VideoRow
    | undefined;
}

export function getVideoWithState(
  id: number,
  userId: number
): VideoWithState | undefined {
  return db
    .prepare(`${WITH_STATE_SELECT} WHERE v.id = @id`)
    .get({ id, userId }) as VideoWithState | undefined;
}

// Up-next list: same folder first (a series plays in order), then the rest of
// the channel by recency. Never crosses the channel boundary.
export function relatedVideos(
  video: VideoRow,
  userId: number,
  limit = 20
): VideoWithState[] {
  const sql = `${WITH_STATE_SELECT}
    WHERE v.channel = @channel AND v.id <> @id
    ORDER BY (v.folder = @folder) DESC,
             CASE WHEN v.folder = @folder
                  THEN v.title COLLATE NOCASE END ASC,
             v.added_at DESC
    LIMIT @limit`;
  return db.prepare(sql).all({
    channel: video.channel,
    id: video.id,
    folder: video.folder,
    userId,
    limit,
  }) as VideoWithState[];
}

// The next video in play order — used by autoplay when one finishes.
export function nextVideo(
  video: VideoRow,
  userId: number
): VideoWithState | undefined {
  return relatedVideos(video, userId, 1)[0];
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function updateVideo(
  id: number,
  fields: { title?: string; description?: string | null }
): VideoRow | undefined {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id };
  if (fields.title !== undefined) {
    const title = fields.title.trim().slice(0, 200);
    if (title) {
      sets.push("title = @title");
      params.title = title;
    }
  }
  if (fields.description !== undefined) {
    sets.push("description = @description");
    params.description = fields.description
      ? fields.description.slice(0, 5000)
      : null;
  }
  if (sets.length) {
    db.prepare(`UPDATE videos SET ${sets.join(", ")} WHERE id = @id`).run(
      params
    );
  }
  return getVideo(id);
}

// Remove a video from the library. deleteFile also unlinks the media itself —
// without it a later scan would simply re-add the row.
export function deleteVideo(id: number, deleteFile: boolean): boolean {
  const row = getVideo(id);
  if (!row) return false;
  db.prepare("DELETE FROM videos WHERE id = ?").run(id);
  deleteArtwork(row);
  if (deleteFile) {
    try {
      fs.rmSync(videoFilePath(row.channel, row.storage_key), { force: true });
    } catch {
      /* the row is gone either way; a stale file is caught by the next scan */
    }
  }
  return true;
}

export function recordView(id: number): void {
  db.prepare("UPDATE videos SET views = views + 1 WHERE id = ?").run(id);
}

// Save the playback position. Anything past 95% counts as finished, so the
// next open starts from the beginning instead of the last few seconds.
export function saveProgress(
  id: number,
  userId: number,
  position: number,
  duration: number | null
): void {
  const safePosition = Number.isFinite(position) ? Math.max(0, position) : 0;
  const percent =
    duration && duration > 0
      ? Math.min(100, Math.round((safePosition / duration) * 100))
      : 0;
  const finished = percent >= 95 ? "datetime('now')" : "NULL";
  db.prepare(
    `INSERT INTO video_progress (video_id, user_id, position, percent, finished_at, updated_at)
     VALUES (@id, @userId, @position, @percent, ${finished}, datetime('now'))
     ON CONFLICT(video_id, user_id) DO UPDATE SET
       position = @position,
       percent = @percent,
       finished_at = ${finished},
       updated_at = datetime('now')`
  ).run({ id, userId, position: safePosition, percent });
}

export function clearProgress(id: number, userId: number): void {
  db.prepare(
    "DELETE FROM video_progress WHERE video_id = ? AND user_id = ?"
  ).run(id, userId);
}

export function toggleLike(
  id: number,
  userId: number
): { liked: boolean; likes: number } {
  const existing = db
    .prepare("SELECT 1 FROM video_likes WHERE video_id = ? AND user_id = ?")
    .get(id, userId);
  if (existing) {
    db.prepare(
      "DELETE FROM video_likes WHERE video_id = ? AND user_id = ?"
    ).run(id, userId);
  } else {
    db.prepare(
      "INSERT INTO video_likes (video_id, user_id) VALUES (?, ?)"
    ).run(id, userId);
  }
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM video_likes WHERE video_id = ?")
    .get(id) as { n: number };
  return { liked: !existing, likes: row.n };
}
