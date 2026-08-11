import fs from "node:fs";
import { db } from "./db";
import type { VideoRow, VideoChannel } from "./db";
import { posterFilePath, videoFilePath } from "./videos-storage";
import {
  buildContactSheet,
  clockLabel,
  describeImage,
  visionConfigured,
  visionModel,
} from "./ai-vision";

// ---------------------------------------------------------------------------
// Vision summaries for the video library.
//
// The library already builds a storyboard sheet per video for the seek-bar
// preview: one JPEG holding a grid of thumbnails sampled evenly across the
// running time. That sheet is exactly what a vision model needs — a hundred
// moments of the film in a single image — so a summary costs one request and a
// few thousand tokens instead of hundreds of separate frames.
//
// Only the `main` channel is summarised by default. The 18+ library is not
// sent to a third-party API: doing so would put explicit material through a
// service whose usage policies forbid it. VIDEO_AI_SUMMARY_CHANNELS can widen
// this, but the default is the safe one.
// ---------------------------------------------------------------------------

export function summaryConfigured(): boolean {
  return visionConfigured();
}

function summaryModel(): string {
  return visionModel();
}

function allowedChannels(): VideoChannel[] {
  const raw = process.env.VIDEO_AI_SUMMARY_CHANNELS || "main";
  return raw
    .split(",")
    .map((c) => c.trim())
    .filter((c): c is VideoChannel => c === "main" || c === "adults");
}

export interface SummaryResult {
  summarised: number;
  failed: number;
  remaining: number;
  message: string;
}

export interface SummaryRunSummary {
  finishedAt: string;
  summarised: number;
  failed: number;
  message: string;
}

let running = false;
let current: { id: number; title: string } | null = null;
let lastRun: SummaryRunSummary | null = null;

// The JSON the model must return. `additionalProperties: false` and a full
// `required` list are what make structured outputs enforceable.
const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description:
        "Two to four sentences describing what happens in the video, in the order it happens. Concrete and specific: setting, who appears, what changes. No hedging about image quality.",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description:
        "Three to eight short lowercase keywords: genre, setting, mood, notable subjects.",
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description:
        "How well the thumbnails support the summary. Use low when the sheet is too dark, repetitive, or uninformative to read.",
    },
  },
  required: ["summary", "tags", "confidence"],
  additionalProperties: false,
} as const;

interface SummaryPayload {
  summary: string;
  tags: string[];
  confidence: "high" | "medium" | "low";
}

function buildPrompt(row: VideoRow): string {
  const grid =
    row.storyboard_cols && row.storyboard_rows
      ? `${row.storyboard_cols} columns by ${row.storyboard_rows} rows`
      : "a grid";
  const spacing = row.storyboard_interval
    ? ` Frames are about ${Math.round(row.storyboard_interval)} seconds apart.`
    : "";
  const runtime = row.duration
    ? ` The video runs ${Math.round(row.duration / 60)} minutes.`
    : "";

  // The title is deliberately included: it is often the only reliable signal
  // for a film whose thumbnails are dark or abstract. Everything else the
  // model gets comes from the pixels.
  return [
    `This image is a contact sheet from a single video: ${grid} of thumbnails, read left to right, top to bottom, sampled evenly from start to finish.${spacing}${runtime}`,
    `The file is titled "${row.title}".`,
    "",
    "Describe what the video is about, based on what you can actually see across the frames. Track how the scenes progress rather than describing one frame. If the sheet does not support a confident reading, say so via the confidence field rather than inventing detail.",
  ].join("\n");
}

async function summariseRow(row: VideoRow): Promise<void> {
  if (!row.storyboard_key) {
    throw new Error("no storyboard sheet for this video");
  }
  const sheetPath = posterFilePath(row.storyboard_key);
  if (!fs.existsSync(sheetPath)) {
    throw new Error("storyboard sheet is missing on disk");
  }

  const image = fs.readFileSync(sheetPath).toString("base64");
  const prompt = buildPrompt(row);
  const raw = await describeImage({
    image,
    prompt,
    schema: SUMMARY_SCHEMA as unknown as Record<string, unknown>,
    schemaName: "video_summary",
  });

  let parsed: SummaryPayload;
  try {
    parsed = JSON.parse(raw) as SummaryPayload;
  } catch {
    throw new Error("model returned malformed JSON");
  }
  if (!parsed.summary?.trim()) throw new Error("model returned an empty summary");

  db.prepare(
    `UPDATE videos
        SET ai_summary = @summary, ai_summary_tags = @tags,
            ai_summary_model = @model, ai_summary_at = @at,
            ai_summary_error = NULL
      WHERE id = @id`
  ).run({
    id: row.id,
    summary: parsed.summary.trim(),
    tags: JSON.stringify(
      (parsed.tags ?? []).map((t) => String(t).trim().toLowerCase()).filter(Boolean)
    ),
    model: `${summaryModel()} (${parsed.confidence})`,
    at: new Date().toISOString(),
  });
}

function pendingRows(limit: number): VideoRow[] {
  const channels = allowedChannels();
  if (channels.length === 0) return [];
  const placeholders = channels.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT * FROM videos
        WHERE ai_summary IS NULL
          AND ai_summary_error IS NULL
          AND storyboard_key IS NOT NULL
          AND channel IN (${placeholders})
        ORDER BY added_at DESC
        LIMIT ?`
    )
    .all(...channels, limit) as VideoRow[];
}

export function pendingSummaries(): number {
  const channels = allowedChannels();
  if (channels.length === 0) return 0;
  const placeholders = channels.map(() => "?").join(",");
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM videos
        WHERE ai_summary IS NULL
          AND ai_summary_error IS NULL
          AND storyboard_key IS NOT NULL
          AND channel IN (${placeholders})`
    )
    .get(...channels) as { n: number };
  return row.n;
}

export function summaryState(): {
  configured: boolean;
  running: boolean;
  pending: number;
  channels: VideoChannel[];
  model: string;
  lastRun: SummaryRunSummary | null;
  currentTitle: string | null;
} {
  return {
    configured: summaryConfigured(),
    running,
    pending: pendingSummaries(),
    channels: allowedChannels(),
    model: summaryModel(),
    lastRun,
    currentTitle: current?.title ?? null,
  };
}

// Work the backlog until the time budget runs out. Each video is one API call,
// so this is bounded by the API rather than by CPU — unlike the transcode
// queue, it can run alongside an encode without competing for the same core.
export async function summarisePending(
  budgetMs = 10 * 60_000
): Promise<SummaryResult> {
  if (!summaryConfigured()) {
    return {
      summarised: 0,
      failed: 0,
      remaining: 0,
      message:
        "No AI key configured — set ANTHROPIC_API_KEY or OPENROUTER_API_KEY.",
    };
  }
  if (running) {
    return {
      summarised: 0,
      failed: 0,
      remaining: pendingSummaries(),
      message: "A summary run is already in progress.",
    };
  }
  running = true;
  const deadline = Date.now() + budgetMs;
  let summarised = 0;
  let failed = 0;

  try {
    for (;;) {
      if (Date.now() >= deadline) break;
      const [row] = pendingRows(1);
      if (!row) break;
      current = { id: row.id, title: row.title };
      try {
        await summariseRow(row);
        summarised++;
      } catch (err) {
        failed++;
        // Stored, not just logged: an error here parks the row so the queue
        // moves on instead of retrying the same failure every run. The Retry
        // button clears it.
        const message = String((err as Error)?.message || err)
          .trim()
          .slice(-500);
        db.prepare(
          "UPDATE videos SET ai_summary_error = ? WHERE id = ?"
        ).run(message, row.id);
      } finally {
        current = null;
      }
    }
  } finally {
    running = false;
    current = null;
  }

  const remaining = pendingSummaries();
  return {
    summarised,
    failed,
    remaining,
    message: `${summarised} summarised, ${failed} failed, ${remaining} still queued.`,
  };
}

// Summarise exactly one video, ignoring the channel allow-list — the per-video
// button is an explicit human choice about that specific file.
export async function summariseOne(id: number): Promise<SummaryResult> {
  if (!summaryConfigured()) {
    return {
      summarised: 0,
      failed: 0,
      remaining: 0,
      message:
        "No AI key configured — set ANTHROPIC_API_KEY or OPENROUTER_API_KEY.",
    };
  }
  if (running) {
    return {
      summarised: 0,
      failed: 0,
      remaining: pendingSummaries(),
      message: "A summary run is already in progress.",
    };
  }
  const row = db.prepare("SELECT * FROM videos WHERE id = ?").get(id) as
    | VideoRow
    | undefined;
  if (!row) {
    return {
      summarised: 0,
      failed: 0,
      remaining: pendingSummaries(),
      message: "No such video.",
    };
  }

  running = true;
  current = { id: row.id, title: row.title };
  try {
    await summariseRow(row);
    return {
      summarised: 1,
      failed: 0,
      remaining: pendingSummaries(),
      message: "Summarised.",
    };
  } catch (err) {
    const message = String((err as Error)?.message || err)
      .trim()
      .slice(-500);
    db.prepare("UPDATE videos SET ai_summary_error = ? WHERE id = ?").run(
      message,
      row.id
    );
    return {
      summarised: 0,
      failed: 1,
      remaining: pendingSummaries(),
      message: `Failed: ${message}`,
    };
  } finally {
    running = false;
    current = null;
  }
}

// ---------------------------------------------------------------------------
// Segment analysis: "what happens between 10:00 and 20:00?"
//
// The stored storyboard covers the whole film at a fixed spacing, which is too
// coarse to answer a question about one stretch. So a segment gets its own
// contact sheet, sampled only within the chosen range.
//
// Frames are grabbed one at a time with an input seek (-ss before -i) rather
// than decoding the whole span through an fps filter: a keyframe jump is
// near-instant, so the cost is the same whether the segment is two minutes or
// two hours. Decoding a 20-minute span on a Pi would take longer than the
// model call it feeds.
// ---------------------------------------------------------------------------

const SEGMENT_COLS = 4;
const SEGMENT_ROWS = 4;

export interface SegmentSummaryRow {
  id: number;
  video_id: number;
  from_seconds: number;
  to_seconds: number;
  summary: string;
  tags: string | null;
  model: string | null;
  created_at: string;
}

/**
 * Describe one stretch of a video. Runs inline rather than in the background:
 * sixteen keyframe grabs plus one model call is tens of seconds, and the
 * caller asked for this specific answer and is waiting for it.
 */
export async function summariseSegment(
  videoId: number,
  fromSeconds: number,
  toSeconds: number
): Promise<SegmentSummaryRow> {
  if (!summaryConfigured()) {
    throw new Error(
      "No AI key configured — set ANTHROPIC_API_KEY or OPENROUTER_API_KEY."
    );
  }
  const row = db.prepare("SELECT * FROM videos WHERE id = ?").get(videoId) as
    | VideoRow
    | undefined;
  if (!row) throw new Error("No such video.");

  const duration = row.duration ?? 0;
  let from = Math.max(0, Math.min(fromSeconds, toSeconds));
  let to = Math.max(fromSeconds, toSeconds);
  if (duration > 0) {
    from = Math.min(from, Math.max(0, duration - 1));
    to = Math.min(to, duration);
  }
  if (to - from < 5) throw new Error("Pick a range of at least 5 seconds.");

  const source = videoFilePath(row.channel, row.storage_key);
  const sheet = await buildContactSheet(source, from, to, {
    columns: SEGMENT_COLS,
    rows: SEGMENT_ROWS,
  });
  if (!sheet) throw new Error("Could not read any frames from that range.");

  {
    const image = sheet.image;
    const prompt = [
      `This image is a contact sheet covering ONE STRETCH of a longer video: ${SEGMENT_COLS} columns by ${SEGMENT_ROWS} rows of thumbnails, read left to right, top to bottom, sampled evenly between ${clockLabel(from)} and ${clockLabel(to)}.`,
      `The video is titled "${row.title}"${duration ? ` and runs ${clockLabel(duration)} in total` : ""}.`,
      "",
      `Describe what happens in this stretch only — not the whole video. Track how the scenes progress across the frames. If the frames do not support a confident reading, say so via the confidence field rather than inventing detail.`,
    ].join("\n");

    const raw = await describeImage({
      image,
      prompt,
      schema: SUMMARY_SCHEMA as unknown as Record<string, unknown>,
      schemaName: "video_segment_summary",
    });

    let parsed: SummaryPayload;
    try {
      parsed = JSON.parse(raw) as SummaryPayload;
    } catch {
      throw new Error("model returned malformed JSON");
    }
    if (!parsed.summary?.trim()) throw new Error("model returned an empty summary");

    const result = db
      .prepare(
        `INSERT INTO video_segment_summaries
           (video_id, from_seconds, to_seconds, summary, tags, model)
         VALUES (@video_id, @from_seconds, @to_seconds, @summary, @tags, @model)
         RETURNING *`
      )
      .get({
        video_id: videoId,
        from_seconds: from,
        to_seconds: to,
        summary: parsed.summary.trim(),
        tags: JSON.stringify(
          (parsed.tags ?? [])
            .map((t) => String(t).trim().toLowerCase())
            .filter(Boolean)
        ),
        model: `${summaryModel()} (${parsed.confidence})`,
      }) as SegmentSummaryRow;
    return result;
  }
}

export interface AnalysedVideo {
  id: number;
  channel: VideoChannel;
  title: string;
  folder: string | null;
  duration: number | null;
  poster_key: string | null;
  ai_summary: string;
  ai_summary_tags: string | null;
  ai_summary_model: string | null;
  ai_summary_at: string | null;
  segment_count: number;
}

/**
 * Everything that has been described, newest first — the reading list behind
 * the Analysis page. Channel-scoped by the caller, because the 18+ library
 * must never leak into the main one.
 */
export function analysedVideos(channel: VideoChannel): AnalysedVideo[] {
  return db
    .prepare(
      `SELECT v.id, v.channel, v.title, v.folder, v.duration, v.poster_key,
              v.ai_summary, v.ai_summary_tags, v.ai_summary_model,
              v.ai_summary_at,
              (SELECT COUNT(*) FROM video_segment_summaries s
                WHERE s.video_id = v.id) AS segment_count
         FROM videos v
        WHERE v.channel = ?
          AND v.ai_summary IS NOT NULL
        ORDER BY v.ai_summary_at DESC`
    )
    .all(channel) as AnalysedVideo[];
}

/** Segment analyses across a whole channel, for the same page. */
export function analysedSegments(
  channel: VideoChannel
): (SegmentSummaryRow & { title: string; poster_key: string | null })[] {
  return db
    .prepare(
      `SELECT s.*, v.title, v.poster_key
         FROM video_segment_summaries s
         JOIN videos v ON v.id = s.video_id
        WHERE v.channel = ?
        ORDER BY s.created_at DESC`
    )
    .all(channel) as (SegmentSummaryRow & {
    title: string;
    poster_key: string | null;
  })[];
}

/**
 * Which channel a video belongs to. Callers use this to apply the same 18+
 * gate the pages do — an API route that skips it is a way around the user's
 * own PIN, which is the whole point of the gate.
 */
export function videoChannelOf(videoId: number): VideoChannel | null {
  const row = db
    .prepare("SELECT channel FROM videos WHERE id = ?")
    .get(videoId) as { channel: VideoChannel } | undefined;
  return row?.channel ?? null;
}

/** The video (and therefore channel) a stored segment belongs to. */
export function segmentOwner(
  segmentId: number
): { videoId: number; channel: VideoChannel } | null {
  const row = db
    .prepare(
      `SELECT s.video_id AS videoId, v.channel AS channel
         FROM video_segment_summaries s
         JOIN videos v ON v.id = s.video_id
        WHERE s.id = ?`
    )
    .get(segmentId) as { videoId: number; channel: VideoChannel } | undefined;
  return row ?? null;
}

export function segmentSummaries(videoId: number): SegmentSummaryRow[] {
  return db
    .prepare(
      `SELECT * FROM video_segment_summaries
        WHERE video_id = ?
        ORDER BY from_seconds ASC`
    )
    .all(videoId) as SegmentSummaryRow[];
}

export function deleteSegmentSummary(id: number): void {
  db.prepare("DELETE FROM video_segment_summaries WHERE id = ?").run(id);
}

// Clear a stored failure so the row re-enters the queue.
export function requeueSummary(id: number): void {
  db.prepare("UPDATE videos SET ai_summary_error = NULL WHERE id = ?").run(id);
}

// Start a run WITHOUT waiting for it: a backlog pass outlives any HTTP
// request, exactly like the transcode queue. Callers poll summaryState().
export function startSummaryRun(budgetMs?: number): {
  started: boolean;
  message: string;
  pending: number;
} {
  if (!summaryConfigured()) {
    return {
      started: false,
      message:
        "No AI key configured — set ANTHROPIC_API_KEY or OPENROUTER_API_KEY.",
      pending: 0,
    };
  }
  if (running) {
    return {
      started: false,
      message: "A summary run is already in progress.",
      pending: pendingSummaries(),
    };
  }
  const pending = pendingSummaries();
  if (pending === 0) {
    return { started: false, message: "Nothing to summarise.", pending: 0 };
  }
  void summarisePending(budgetMs)
    .then((r) => {
      lastRun = {
        finishedAt: new Date().toISOString(),
        summarised: r.summarised,
        failed: r.failed,
        message: r.message,
      };
    })
    .catch((err) => {
      lastRun = {
        finishedAt: new Date().toISOString(),
        summarised: 0,
        failed: 0,
        message: `Run aborted: ${String((err as Error)?.message || err)}`,
      };
    });
  return {
    started: true,
    message: `Summarising ${pending} video${pending === 1 ? "" : "s"} in the background.`,
    pending,
  };
}

export function startSummaryOne(id: number): {
  started: boolean;
  message: string;
} {
  if (!summaryConfigured()) {
    return {
      started: false,
      message:
        "No AI key configured — set ANTHROPIC_API_KEY or OPENROUTER_API_KEY.",
    };
  }
  if (running) {
    return { started: false, message: "A summary run is already in progress." };
  }
  void summariseOne(id)
    .then((r) => {
      lastRun = {
        finishedAt: new Date().toISOString(),
        summarised: r.summarised,
        failed: r.failed,
        message: r.message,
      };
    })
    .catch((err) => {
      lastRun = {
        finishedAt: new Date().toISOString(),
        summarised: 0,
        failed: 1,
        message: String((err as Error)?.message || err),
      };
    });
  return { started: true, message: "Summarising in the background." };
}

// Parsed form for the UI. Tags are stored as a JSON array; a bad value must
// never break the page.
export function parseSummaryTags(row: {
  ai_summary_tags: string | null;
}): string[] {
  if (!row.ai_summary_tags) return [];
  try {
    const parsed = JSON.parse(row.ai_summary_tags);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
