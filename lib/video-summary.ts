import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import type { VideoRow, VideoChannel } from "./db";
import { posterFilePath, videoFilePath } from "./videos-storage";

const execFile = promisify(execFileCb);

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

// The same Claude models are reachable two ways: Anthropic directly, or
// OpenRouter's OpenAI-shaped API. Which one to use depends on where the
// account credit is, so the provider is picked from whichever key is present.
type ProviderKind = "anthropic" | "openrouter";

const DEFAULT_MODELS: Record<ProviderKind, string> = {
  anthropic: "claude-opus-5",
  openrouter: "anthropic/claude-opus-5",
};

// A summary is a short read of a contact sheet, not a reasoning problem —
// medium effort is plenty and keeps the per-video cost down. Raise it with
// VIDEO_AI_EFFORT if summaries come out shallow.
const DEFAULT_EFFORT = "medium";

function providerKind(): ProviderKind {
  const forced = process.env.VIDEO_AI_PROVIDER as ProviderKind | undefined;
  if (forced === "anthropic" || forced === "openrouter") return forced;
  return process.env.ANTHROPIC_API_KEY ? "anthropic" : "openrouter";
}

export function summaryConfigured(): boolean {
  return providerKind() === "anthropic"
    ? Boolean(process.env.ANTHROPIC_API_KEY)
    : Boolean(process.env.OPENROUTER_API_KEY);
}

function summaryModel(): string {
  return process.env.VIDEO_AI_MODEL || DEFAULT_MODELS[providerKind()];
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

async function askAnthropic(image: string, prompt: string): Promise<string> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: summaryModel(),
    max_tokens: 8000,
    output_config: {
      effort: (process.env.VIDEO_AI_EFFORT || DEFAULT_EFFORT) as "low",
      format: { type: "json_schema", schema: SUMMARY_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: image },
          },
          { type: "text", text: prompt },
        ],
      },
    ],
  });

  // Safety classifiers can decline a request: that arrives as a normal 200
  // with an empty content array, so checking stop_reason has to come first.
  if (response.stop_reason === "refusal") {
    throw new Error(
      `model declined to describe this video (${response.stop_details?.category ?? "unspecified"})`
    );
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("model hit the token limit before finishing");
  }

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("model returned no text block");
  }
  return text.text;
}

async function askOpenRouter(image: string, prompt: string): Promise<string> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "X-Title": "elite-v2 video summaries",
    },
    body: JSON.stringify({
      model: summaryModel(),
      max_tokens: 8000,
      reasoning: { effort: process.env.VIDEO_AI_EFFORT || DEFAULT_EFFORT },
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "video_summary",
          strict: true,
          schema: SUMMARY_SCHEMA,
        },
      },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${image}` },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    let detail = body.slice(0, 200);
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } };
      if (parsed.error?.message) detail = parsed.error.message;
    } catch {
      /* keep the raw body */
    }
    throw new Error(`OpenRouter returned ${response.status}: ${detail}`);
  }

  const data = (await response.json()) as {
    choices?: {
      message?: { content?: string | null };
      finish_reason?: string;
      native_finish_reason?: string;
    }[];
    error?: { message?: string };
  };
  if (data.error?.message) throw new Error(`OpenRouter: ${data.error.message}`);

  const choice = data.choices?.[0];
  const text = choice?.message?.content;
  if (!text) {
    // A refused or truncated turn comes back as an empty content string with
    // the reason in finish_reason — surfacing that beats "malformed JSON".
    throw new Error(
      `model returned no text (finish_reason: ${
        choice?.native_finish_reason ?? choice?.finish_reason ?? "unknown"
      })`
    );
  }
  return text;
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
  const raw =
    providerKind() === "anthropic"
      ? await askAnthropic(image, prompt)
      : await askOpenRouter(image, prompt);

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

async function buildSegmentSheet(
  row: VideoRow,
  fromSeconds: number,
  toSeconds: number
): Promise<{ sheet: string; dir: string } | null> {
  const src = videoFilePath(row.channel, row.storage_key);
  if (!fs.existsSync(src)) throw new Error("the video file is gone");

  const frames = SEGMENT_COLS * SEGMENT_ROWS;
  const span = Math.max(1, toSeconds - fromSeconds);
  const step = span / frames;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "video-seg-"));

  let lastGood: string | null = null;
  for (let i = 0; i < frames; i++) {
    const at = fromSeconds + i * step;
    const frame = path.join(dir, `f${String(i).padStart(4, "0")}.jpg`);
    try {
      await execFile(
        "nice",
        [
          "-n",
          "19",
          "ffmpeg",
          "-y",
          "-hide_banner",
          "-loglevel",
          "error",
          "-nostdin",
          "-ss",
          at.toFixed(3),
          "-i",
          src,
          "-frames:v",
          "1",
          "-vf",
          "scale=320:-2",
          "-q:v",
          "4",
          frame,
        ],
        { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }
      );
    } catch {
      /* filled from the previous frame below */
    }
    if (fs.existsSync(frame) && fs.statSync(frame).size > 0) {
      lastGood = frame;
    } else if (lastGood) {
      // The image-sequence demuxer stops at the first missing index, so a
      // frame ffmpeg could not grab is filled with the one before it.
      fs.copyFileSync(lastGood, frame);
    } else {
      fs.rmSync(dir, { recursive: true, force: true });
      return null; // nothing decodable in this range at all
    }
  }

  const sheet = path.join(dir, "sheet.jpg");
  await execFile(
    "nice",
    [
      "-n",
      "19",
      "ffmpeg",
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
      path.join(dir, "f%04d.jpg"),
      "-frames:v",
      "1",
      "-vf",
      `tile=${SEGMENT_COLS}x${SEGMENT_ROWS}`,
      "-q:v",
      "4",
      sheet,
    ],
    { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }
  );

  if (!fs.existsSync(sheet) || fs.statSync(sheet).size === 0) {
    fs.rmSync(dir, { recursive: true, force: true });
    return null;
  }
  return { sheet, dir };
}

function clockLabel(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
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

  const built = await buildSegmentSheet(row, from, to);
  if (!built) throw new Error("Could not read any frames from that range.");

  try {
    const image = fs.readFileSync(built.sheet).toString("base64");
    const prompt = [
      `This image is a contact sheet covering ONE STRETCH of a longer video: ${SEGMENT_COLS} columns by ${SEGMENT_ROWS} rows of thumbnails, read left to right, top to bottom, sampled evenly between ${clockLabel(from)} and ${clockLabel(to)}.`,
      `The video is titled "${row.title}"${duration ? ` and runs ${clockLabel(duration)} in total` : ""}.`,
      "",
      `Describe what happens in this stretch only — not the whole video. Track how the scenes progress across the frames. If the frames do not support a confident reading, say so via the confidence field rather than inventing detail.`,
    ].join("\n");

    const raw =
      providerKind() === "anthropic"
        ? await askAnthropic(image, prompt)
        : await askOpenRouter(image, prompt);

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
  } finally {
    fs.rmSync(built.dir, { recursive: true, force: true });
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
