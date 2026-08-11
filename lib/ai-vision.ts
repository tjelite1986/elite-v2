import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import Anthropic from "@anthropic-ai/sdk";

const execFile = promisify(execFileCb);

// ffmpeg work is niced so a sheet never starves the web app or a transcode.
async function run(args: string[], timeoutMs: number): Promise<void> {
  await execFile("nice", ["-n", "19", "ffmpeg", ...args], {
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });
}

// ---------------------------------------------------------------------------
// One way to ask a vision model about a JPEG.
//
// The same Claude models are reachable two ways: Anthropic directly, or
// OpenRouter's OpenAI-shaped API. Which one to use depends on where the
// account credit sits, so the provider is picked from whichever key is
// present. Callers work in terms of describeImage() and never know which ran.
// ---------------------------------------------------------------------------

export type ProviderKind = "anthropic" | "openrouter";

const DEFAULT_MODELS: Record<ProviderKind, string> = {
  anthropic: "claude-opus-5",
  openrouter: "anthropic/claude-opus-5",
};

// Reading a contact sheet is not a reasoning problem — medium effort is plenty
// and keeps the per-clip cost down. Raise it with VIDEO_AI_EFFORT if summaries
// come out shallow.
const DEFAULT_EFFORT = "medium";

export function providerKind(): ProviderKind {
  const forced = process.env.VIDEO_AI_PROVIDER as ProviderKind | undefined;
  if (forced === "anthropic" || forced === "openrouter") return forced;
  return process.env.ANTHROPIC_API_KEY ? "anthropic" : "openrouter";
}

export function visionConfigured(): boolean {
  return providerKind() === "anthropic"
    ? Boolean(process.env.ANTHROPIC_API_KEY)
    : Boolean(process.env.OPENROUTER_API_KEY);
}

export function visionModel(): string {
  return process.env.VIDEO_AI_MODEL || DEFAULT_MODELS[providerKind()];
}

function effort(): string {
  return process.env.VIDEO_AI_EFFORT || DEFAULT_EFFORT;
}

export interface DescribeRequest {
  /** Base64-encoded JPEG. */
  image: string;
  prompt: string;
  schema: Record<string, unknown>;
  schemaName: string;
  maxTokens?: number;
}

/** Returns the model's raw reply, which the caller parses against its schema. */
export async function describeImage(req: DescribeRequest): Promise<string> {
  return providerKind() === "anthropic"
    ? askAnthropic(req)
    : askOpenRouter(req);
}

async function askAnthropic(req: DescribeRequest): Promise<string> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: visionModel(),
    max_tokens: req.maxTokens ?? 8000,
    output_config: {
      effort: effort() as "medium",
      format: { type: "json_schema", schema: req.schema },
    },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: req.image,
            },
          },
          { type: "text", text: req.prompt },
        ],
      },
    ],
  });

  // Safety classifiers can decline a request: that arrives as a normal 200
  // with an empty content array, so checking stop_reason has to come first.
  if (response.stop_reason === "refusal") {
    throw new Error(
      `model declined to describe this (${response.stop_details?.category ?? "unspecified"})`
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

async function askOpenRouter(req: DescribeRequest): Promise<string> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "X-Title": "elite-v2 video summaries",
    },
    body: JSON.stringify({
      model: visionModel(),
      max_tokens: req.maxTokens ?? 8000,
      reasoning: { effort: effort() },
      response_format: {
        type: "json_schema",
        json_schema: {
          name: req.schemaName,
          strict: true,
          schema: req.schema,
        },
      },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${req.image}` },
            },
            { type: "text", text: req.prompt },
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

// ---------------------------------------------------------------------------
// Contact sheets
//
// A grid of frames in ONE image is what makes this cheap: a vision model reads
// the whole grid for about what a single screenshot costs, so twenty moments
// of a clip are nearly free.
//
// Frames are grabbed one at a time with an input seek (-ss before -i) rather
// than decoding the span through an fps filter: a keyframe jump is
// near-instant, so cost does not scale with how long the range is.
// ---------------------------------------------------------------------------

export interface SheetSpec {
  columns: number;
  rows: number;
}

export interface BuiltSheet {
  /** Base64 JPEG, ready to send. */
  image: string;
  columns: number;
  rows: number;
}

/**
 * Sample `columns x rows` frames evenly between two timestamps and tile them
 * into one JPEG. Returns null when nothing in the range could be decoded.
 * The temporary directory is always cleaned up.
 */
export async function buildContactSheet(
  sourcePath: string,
  fromSeconds: number,
  toSeconds: number,
  spec: SheetSpec
): Promise<BuiltSheet | null> {
  if (!fs.existsSync(sourcePath)) throw new Error("the media file is gone");

  const frames = spec.columns * spec.rows;
  const span = Math.max(1, toSeconds - fromSeconds);
  const step = span / frames;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-sheet-"));

  try {
    let lastGood: string | null = null;
    for (let i = 0; i < frames; i++) {
      const at = fromSeconds + i * step;
      const frame = path.join(dir, `f${String(i).padStart(4, "0")}.jpg`);
      try {
        await run(
          [
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-ss",
            at.toFixed(3),
            "-i",
            sourcePath,
            "-frames:v",
            "1",
            "-vf",
            "scale=320:-2",
            "-q:v",
            "4",
            frame,
          ],
          60_000
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
        return null; // nothing decodable in this range at all
      }
    }

    const sheet = path.join(dir, "sheet.jpg");
    await run(
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
        path.join(dir, "f%04d.jpg"),
        "-frames:v",
        "1",
        "-vf",
        `tile=${spec.columns}x${spec.rows}`,
        "-q:v",
        "4",
        sheet,
      ],
      120_000
    );

    if (!fs.existsSync(sheet) || fs.statSync(sheet).size === 0) return null;
    return {
      image: fs.readFileSync(sheet).toString("base64"),
      columns: spec.columns,
      rows: spec.rows,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Shared clock formatting for prompts and stored labels. */
export function clockLabel(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}
