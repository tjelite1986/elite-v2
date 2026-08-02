import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { db } from "./db";
import type { VideoRow, VideoChannel } from "./db";
import { has18Access } from "./shorts-gate";
import {
  VIDEOS_ROOT,
  VIDEO_CHANNELS,
  artworkStem,
  channelAvailable,
  channelDir,
  ensureVideoDirs,
  postersDir,
  posterFilePath,
  videoFilePath,
  walkChannel,
} from "./videos-storage";

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
// ---------------------------------------------------------------------------

type Probe = {
  duration: number | null;
  width: number | null;
  height: number | null;
};

function probeVideo(filePath: string): Probe {
  const probe: Probe = { duration: null, width: null, height: null };
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
    const duration = Number(data.format?.duration);
    if (Number.isFinite(duration) && duration > 0) probe.duration = duration;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (data.streams || []).find((s: any) => s.codec_type === "video");
    if (v) {
      if (typeof v.width === "number") probe.width = v.width;
      if (typeof v.height === "number") probe.height = v.height;
      const rot = Math.abs(
        Number(v.tags?.rotate ?? v.side_data_list?.[0]?.rotation ?? 0)
      );
      if ((rot === 90 || rot === 270) && probe.width && probe.height) {
        [probe.width, probe.height] = [probe.height, probe.width];
      }
      if (probe.duration === null) {
        const streamDuration = Number(v.duration);
        if (Number.isFinite(streamDuration) && streamDuration > 0) {
          probe.duration = streamDuration;
        }
      }
    }
  } catch {
    /* ffprobe missing or unreadable file — the row just stays without meta */
  }
  return probe;
}

// Poster frame, taken ~10% in (past title cards / black intros), scaled to a
// 640px-wide grid thumbnail. Returns the poster filename or null.
function makePoster(
  filePath: string,
  stem: string,
  duration: number | null
): string | null {
  const name = `${stem}.jpg`;
  const out = posterFilePath(name);
  const seek = duration && duration > 20 ? Math.floor(duration * 0.1) : 1;
  const run = (at: number): boolean => {
    try {
      execFileSync(
        "ffmpeg",
        [
          "-y",
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
        { stdio: "ignore", timeout: 120_000 }
      );
    } catch {
      /* checked via the output file below */
    }
    return fs.existsSync(out) && fs.statSync(out).size > 0;
  };
  return run(seek) || run(1) || run(0) ? name : null;
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
// (one request instead of hundreds of thumbnails). Best-effort — a video with no
// storyboard simply falls back to a plain time tooltip.
function makeStoryboard(
  filePath: string,
  stem: string,
  duration: number | null,
  height: number | null,
  width: number | null
): Storyboard | null {
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
  try {
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-i",
        filePath,
        "-vf",
        `fps=${(1 / interval).toFixed(6)},scale=${tileW}:${tileH},tile=${cols}x${rows}`,
        "-frames:v",
        "1",
        "-q:v",
        "6",
        out,
      ],
      { stdio: "ignore", timeout: 600_000 }
    );
  } catch {
    /* checked via the output file below */
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
  skipped: boolean;
  message: string;
}

// Mirror one channel directory into the DB. New files are inserted (with a
// probe + poster + storyboard), files whose size/mtime changed are re-probed,
// and rows whose file is gone are deleted — but ONLY when the directory looks
// mounted, so an unmounted volume can never wipe the library.
export function scanVideoChannel(channel: VideoChannel): ScanResult {
  ensureVideoDirs();
  const result: ScanResult = {
    channel,
    added: 0,
    updated: 0,
    removed: 0,
    artwork: 0,
    skipped: false,
    message: "",
  };

  const files = walkChannel(channel);
  const existing = db
    .prepare("SELECT * FROM videos WHERE channel = ?")
    .all(channel) as VideoRow[];
  const byKey = new Map(existing.map((row) => [row.storage_key, row]));

  const insert = db.prepare(
    `INSERT INTO videos (channel, storage_key, folder, title, poster_key,
       storyboard_key, storyboard_cols, storyboard_rows, storyboard_interval,
       storyboard_tile_w, storyboard_tile_h, duration, width, height,
       size_bytes, file_mtime)
     VALUES (@channel, @storage_key, @folder, @title, @poster_key,
       @storyboard_key, @storyboard_cols, @storyboard_rows, @storyboard_interval,
       @storyboard_tile_w, @storyboard_tile_h, @duration, @width, @height,
       @size_bytes, @file_mtime)`
  );
  const updateMeta = db.prepare(
    `UPDATE videos SET folder = @folder, duration = @duration, width = @width,
       height = @height, size_bytes = @size_bytes, file_mtime = @file_mtime,
       poster_key = @poster_key, storyboard_key = @storyboard_key,
       storyboard_cols = @storyboard_cols, storyboard_rows = @storyboard_rows,
       storyboard_interval = @storyboard_interval,
       storyboard_tile_w = @storyboard_tile_w,
       storyboard_tile_h = @storyboard_tile_h
     WHERE id = @id`
  );

  for (const file of files) {
    const row = byKey.get(file.storageKey);
    const filePath = videoFilePath(channel, file.storageKey);
    const stem = artworkStem(channel, file.storageKey);

    if (!row) {
      const probe = probeVideo(filePath);
      const poster = makePoster(filePath, stem, probe.duration);
      const sb = makeStoryboard(
        filePath,
        stem,
        probe.duration,
        probe.height,
        probe.width
      );
      insert.run({
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
      });
      result.added++;
      if (poster) result.artwork++;
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
      ? probeVideo(filePath)
      : {
          duration: row.duration,
          width: row.width,
          height: row.height,
        };
    const poster =
      changed || posterMissing
        ? makePoster(filePath, stem, probe.duration)
        : row.poster_key;
    const sb =
      changed || !row.storyboard_key
        ? makeStoryboard(
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
    });
    result.updated++;
    if (poster && poster !== row.poster_key) result.artwork++;
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
        del.run(row.id);
        deleteArtwork(row);
        result.removed++;
      }
    }
  }

  if (!result.message) {
    result.message = `${result.added} added, ${result.updated} updated, ${result.removed} removed.`;
  }
  return result;
}

export function scanAllVideos(): ScanResult[] {
  return VIDEO_CHANNELS.map(scanVideoChannel);
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
  return db
    .prepare(
      `SELECT folder, COUNT(*) AS count FROM videos
        WHERE channel = ? AND folder <> ''
        GROUP BY folder
        ORDER BY folder COLLATE NOCASE ASC`
    )
    .all(channel) as { folder: string; count: number }[];
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

// Library size on disk, for the Settings storage view.
export function videoLibraryStats(): {
  channel: VideoChannel;
  count: number;
  bytes: number;
  hostDir: string;
}[] {
  return VIDEO_CHANNELS.map((channel) => {
    const row = db
      .prepare(
        "SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS bytes FROM videos WHERE channel = ?"
      )
      .get(channel) as { count: number; bytes: number };
    return { channel, ...row, hostDir: channelDir(channel) };
  });
}

export const VIDEO_PATHS = { root: VIDEOS_ROOT, posters: postersDir() };
