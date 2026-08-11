import { db } from "./db";
import type { ShortRow, ShortChannel } from "./db";
import { videoPathFor } from "./shorts-storage";
import {
  buildContactSheet,
  clockLabel,
  describeImage,
  visionConfigured,
  visionModel,
} from "./ai-vision";

// ---------------------------------------------------------------------------
// Vision summaries for shorts.
//
// Unlike the long-form library, shorts have no stored storyboard — they are
// too short to need a scrub preview — so the contact sheet is built at describe
// time from the clip itself. A clip is short enough that one sheet covers the
// whole thing, which is why there is no segment tool here: picking a range out
// of forty seconds is not a question anyone has.
//
// Only the main channel is summarised by default, for the same reason as the
// video library: the 18+ channel is not sent to a third-party API.
// SHORT_AI_SUMMARY_CHANNELS can widen it deliberately.
// ---------------------------------------------------------------------------

const SHEET = { columns: 4, rows: 4 };

export function shortSummaryConfigured(): boolean {
  return visionConfigured();
}

function allowedChannels(): ShortChannel[] {
  const raw = process.env.SHORT_AI_SUMMARY_CHANNELS || "main";
  return raw
    .split(",")
    .map((c) => c.trim())
    .filter((c): c is ShortChannel => c === "main" || c === "18plus");
}

const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description:
        "One to three sentences describing what happens in the clip, in the order it happens. Concrete: setting, who appears, what they do. No hedging about image quality.",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description:
        "Three to eight short lowercase keywords: subject, setting, activity, mood.",
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description:
        "How well the frames support the summary. Use low when they are too dark, repetitive, or uninformative to read.",
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

export interface ShortSummaryResult {
  summarised: number;
  failed: number;
  remaining: number;
  message: string;
}

export interface ShortSummaryRunSummary {
  finishedAt: string;
  summarised: number;
  failed: number;
  message: string;
}

let running = false;
let current: { id: number; caption: string | null } | null = null;
let lastRun: ShortSummaryRunSummary | null = null;

function buildPrompt(row: ShortRow): string {
  const duration = row.duration
    ? ` The clip runs ${clockLabel(row.duration)}.`
    : "";
  const caption = row.caption?.trim()
    ? `\nIts caption reads: "${row.caption.trim()}".`
    : "";
  return [
    `This image is a contact sheet from a single short video: ${SHEET.columns} columns by ${SHEET.rows} rows of frames, read left to right, top to bottom, sampled evenly from start to finish.${duration}${caption}`,
    "",
    "Describe what happens in the clip, based on what you can actually see across the frames. Track how it progresses rather than describing one frame. If the frames do not support a confident reading, say so via the confidence field rather than inventing detail.",
  ].join("\n");
}

async function summariseRow(row: ShortRow): Promise<void> {
  const source = videoPathFor(row.channel, row.storage_key);
  const sheet = await buildContactSheet(
    source,
    0,
    row.duration && row.duration > 1 ? row.duration : 30,
    SHEET
  );
  if (!sheet) throw new Error("could not read any frames from this clip");

  const raw = await describeImage({
    image: sheet.image,
    prompt: buildPrompt(row),
    schema: SUMMARY_SCHEMA as unknown as Record<string, unknown>,
    schemaName: "short_summary",
  });

  let parsed: SummaryPayload;
  try {
    parsed = JSON.parse(raw) as SummaryPayload;
  } catch {
    throw new Error("model returned malformed JSON");
  }
  if (!parsed.summary?.trim()) throw new Error("model returned an empty summary");

  db.prepare(
    `UPDATE shorts
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
    model: `${visionModel()} (${parsed.confidence})`,
    at: new Date().toISOString(),
  });
}

function pendingRows(limit: number): ShortRow[] {
  const channels = allowedChannels();
  if (channels.length === 0) return [];
  const placeholders = channels.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT * FROM shorts
        WHERE ai_summary IS NULL
          AND ai_summary_error IS NULL
          AND is_deleted = 0
          AND status = 'ready'
          AND channel IN (${placeholders})
        ORDER BY created_at DESC
        LIMIT ?`
    )
    .all(...channels, limit) as ShortRow[];
}

export function pendingShortSummaries(): number {
  const channels = allowedChannels();
  if (channels.length === 0) return 0;
  const placeholders = channels.map(() => "?").join(",");
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM shorts
        WHERE ai_summary IS NULL
          AND ai_summary_error IS NULL
          AND is_deleted = 0
          AND status = 'ready'
          AND channel IN (${placeholders})`
    )
    .get(...channels) as { n: number };
  return row.n;
}

export function shortSummaryState(): {
  configured: boolean;
  running: boolean;
  pending: number;
  channels: ShortChannel[];
  model: string;
  lastRun: ShortSummaryRunSummary | null;
  currentId: number | null;
} {
  return {
    configured: shortSummaryConfigured(),
    running,
    pending: pendingShortSummaries(),
    channels: allowedChannels(),
    model: visionModel(),
    lastRun,
    currentId: current?.id ?? null,
  };
}

export async function summariseShortsPending(
  budgetMs = 10 * 60_000
): Promise<ShortSummaryResult> {
  if (!shortSummaryConfigured()) {
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
      remaining: pendingShortSummaries(),
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
      current = { id: row.id, caption: row.caption };
      try {
        await summariseRow(row);
        summarised++;
      } catch (err) {
        failed++;
        // Stored, not just logged: a clip that cannot be read parks itself so
        // the queue moves on instead of retrying the same failure every run.
        const message = String((err as Error)?.message || err)
          .trim()
          .slice(-500);
        db.prepare("UPDATE shorts SET ai_summary_error = ? WHERE id = ?").run(
          message,
          row.id
        );
      } finally {
        current = null;
      }
    }
  } finally {
    running = false;
    current = null;
  }

  const remaining = pendingShortSummaries();
  return {
    summarised,
    failed,
    remaining,
    message: `${summarised} summarised, ${failed} failed, ${remaining} still queued.`,
  };
}

/** Describe exactly one clip, ignoring the channel allow-list — the per-clip
 *  button is an explicit human choice about that specific short. */
export async function summariseShortOne(
  id: number
): Promise<ShortSummaryResult> {
  if (!shortSummaryConfigured()) {
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
      remaining: pendingShortSummaries(),
      message: "A summary run is already in progress.",
    };
  }
  const row = db
    .prepare("SELECT * FROM shorts WHERE id = ? AND is_deleted = 0")
    .get(id) as ShortRow | undefined;
  if (!row) {
    return {
      summarised: 0,
      failed: 0,
      remaining: pendingShortSummaries(),
      message: "No such clip.",
    };
  }

  running = true;
  current = { id: row.id, caption: row.caption };
  try {
    await summariseRow(row);
    return {
      summarised: 1,
      failed: 0,
      remaining: pendingShortSummaries(),
      message: "Summarised.",
    };
  } catch (err) {
    const message = String((err as Error)?.message || err)
      .trim()
      .slice(-500);
    db.prepare("UPDATE shorts SET ai_summary_error = ? WHERE id = ?").run(
      message,
      row.id
    );
    return {
      summarised: 0,
      failed: 1,
      remaining: pendingShortSummaries(),
      message: `Failed: ${message}`,
    };
  } finally {
    running = false;
    current = null;
  }
}

export function requeueShortSummary(id: number): void {
  db.prepare("UPDATE shorts SET ai_summary_error = NULL WHERE id = ?").run(id);
}

export function shortChannelOf(id: number): ShortChannel | null {
  const row = db.prepare("SELECT channel FROM shorts WHERE id = ?").get(id) as
    | { channel: ShortChannel }
    | undefined;
  return row?.channel ?? null;
}

export function startShortSummaryRun(budgetMs?: number): {
  started: boolean;
  message: string;
  pending: number;
} {
  if (!shortSummaryConfigured()) {
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
      pending: pendingShortSummaries(),
    };
  }
  const pending = pendingShortSummaries();
  if (pending === 0) {
    return { started: false, message: "Nothing to summarise.", pending: 0 };
  }
  void summariseShortsPending(budgetMs)
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
    message: `Summarising ${pending} clip${pending === 1 ? "" : "s"} in the background.`,
    pending,
  };
}

export function startShortSummaryOne(id: number): {
  started: boolean;
  message: string;
} {
  if (!shortSummaryConfigured()) {
    return {
      started: false,
      message:
        "No AI key configured — set ANTHROPIC_API_KEY or OPENROUTER_API_KEY.",
    };
  }
  if (running) {
    return { started: false, message: "A summary run is already in progress." };
  }
  void summariseShortOne(id)
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

export interface AnalysedShort {
  id: number;
  channel: ShortChannel;
  caption: string | null;
  duration: number | null;
  poster_key: string | null;
  ai_summary: string;
  ai_summary_tags: string | null;
  ai_summary_at: string | null;
}

/** Everything described in one channel, newest first — the Analysis page. */
export function analysedShorts(channel: ShortChannel): AnalysedShort[] {
  return db
    .prepare(
      `SELECT id, channel, caption, duration, poster_key, ai_summary,
              ai_summary_tags, ai_summary_at
         FROM shorts
        WHERE channel = ?
          AND is_deleted = 0
          AND is_private = 0
          AND ai_summary IS NOT NULL
        ORDER BY ai_summary_at DESC`
    )
    .all(channel) as AnalysedShort[];
}
