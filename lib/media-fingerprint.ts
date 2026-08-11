import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

// ---------------------------------------------------------------------------
// Perceptual fingerprints for whole clips.
//
// A hash of one frame identifies a frame, not a video: two clips that open on
// the same black frame collide, and a clip re-encoded with a different opening
// does not. So the fingerprint is taken across the clip's PROGRESSION — the
// same sampling the contact sheet uses — which makes it a signature of how the
// video unfolds rather than of any single moment.
//
// Two parts, deliberately:
//
//   dHash    64 bits per sampled frame, from a 9x8 greyscale reduction. Robust
//            to re-encoding, scaling and mild cropping. COLOUR-BLIND: a
//            greyscale edit of a clip has the same dHash as the original.
//   colours  the mean RGB of each frame. Cheap, and exactly the signal dHash
//            throws away — so a black-and-white re-upload no longer reads as
//            an identical file.
//
// Both are needed. That colour blindness has bitten this library before.
// ---------------------------------------------------------------------------

/** Frames sampled per clip. Sixteen matches the contact sheet's grid. */
export const FINGERPRINT_FRAMES = 16;

export interface Fingerprint {
  /** FINGERPRINT_FRAMES * 16 hex chars — 64 bits per frame. */
  dhash: string;
  /** FINGERPRINT_FRAMES * 6 hex chars — mean RGB per frame. */
  colors: string;
  frames: number;
}

/**
 * One ffmpeg call per sampled frame, each an input seek (-ss before -i) so the
 * cost does not scale with the clip's length. Raw RGB straight to stdout: 9x8
 * pixels is 216 bytes, so there is no image decoding to do on our side and no
 * temporary files to clean up.
 */
async function sampleFrame(
  sourcePath: string,
  atSeconds: number
): Promise<{ dhash: string; rgb: [number, number, number] } | null> {
  let stdout: Buffer;
  try {
    const result = await execFile(
      "nice",
      [
        "-n",
        "19",
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-ss",
        atSeconds.toFixed(3),
        "-i",
        sourcePath,
        "-frames:v",
        "1",
        // 9 wide so each row yields 8 horizontal comparisons.
        "-vf",
        "scale=9:8,format=rgb24",
        "-f",
        "rawvideo",
        "-",
      ],
      { timeout: 60_000, maxBuffer: 1024 * 1024, encoding: "buffer" }
    );
    stdout = result.stdout as Buffer;
  } catch {
    return null;
  }
  if (stdout.length < 9 * 8 * 3) return null;

  // Greyscale reduction, then the classic difference hash: each pixel compared
  // with its right-hand neighbour, one bit per comparison.
  const grey: number[] = [];
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  for (let i = 0; i < 9 * 8; i++) {
    const r = stdout[i * 3];
    const g = stdout[i * 3 + 1];
    const b = stdout[i * 3 + 2];
    rSum += r;
    gSum += g;
    bSum += b;
    grey.push(0.299 * r + 0.587 * g + 0.114 * b);
  }

  // Built a nibble at a time rather than as a 64-bit integer: the project
  // targets below ES2020, so BigInt literals are unavailable — and hex is the
  // storage format anyway.
  let hash = "";
  let nibble = 0;
  let bitsInNibble = 0;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const left = grey[row * 9 + col];
      const right = grey[row * 9 + col + 1];
      nibble = (nibble << 1) | (left > right ? 1 : 0);
      if (++bitsInNibble === 4) {
        hash += nibble.toString(16);
        nibble = 0;
        bitsInNibble = 0;
      }
    }
  }

  const pixels = 9 * 8;
  return {
    dhash: hash,
    rgb: [
      Math.round(rSum / pixels),
      Math.round(gSum / pixels),
      Math.round(bSum / pixels),
    ],
  };
}

/** Ask the file how long it is. */
async function probeDuration(sourcePath: string): Promise<number | null> {
  try {
    const { stdout } = await execFile(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=nw=1:nk=1",
        sourcePath,
      ],
      { timeout: 30_000, maxBuffer: 64 * 1024 }
    );
    const n = Number(String(stdout).trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Fingerprint a clip. Returns null when too little of it could be decoded to
 * be worth comparing — a truncated download should not get a fingerprint that
 * looks like a real one.
 */
export async function fingerprintVideo(
  sourcePath: string,
  durationSeconds: number | null
): Promise<Fingerprint | null> {
  // The duration decides where to sample, so a missing one is not a detail to
  // shrug at: without it the fallback spacing walks off the end of a short
  // clip and most frames come back empty, which reads as "damaged file". Ask
  // the file instead — plenty of rows carry no duration yet.
  const duration =
    durationSeconds && durationSeconds > 1
      ? durationSeconds
      : await probeDuration(sourcePath);

  const dhashParts: string[] = [];
  const colorParts: string[] = [];
  let decoded = 0;

  for (let i = 0; i < FINGERPRINT_FRAMES; i++) {
    // Sample inside the clip rather than at its very edges: the first and last
    // frames are often black or a title card, which are the least
    // distinguishing parts of any video.
    const fraction = (i + 1) / (FINGERPRINT_FRAMES + 1);
    // With no duration even after probing, fall back to a tight spacing that
    // stays inside even a very short clip.
    const at = duration ? duration * fraction : i * 0.5;
    const frame = await sampleFrame(sourcePath, at);
    if (!frame) {
      // Keep the slot so frames stay positionally comparable between clips.
      dhashParts.push("0000000000000000");
      colorParts.push("000000");
      continue;
    }
    decoded++;
    dhashParts.push(frame.dhash);
    colorParts.push(
      frame.rgb.map((c) => c.toString(16).padStart(2, "0")).join("")
    );
  }

  // Fewer than half the frames readable means the file is damaged, not that
  // the video is unusual.
  if (decoded < FINGERPRINT_FRAMES / 2) return null;

  return {
    dhash: dhashParts.join(""),
    colors: colorParts.join(""),
    frames: FINGERPRINT_FRAMES,
  };
}

// Set bits per hex digit, so distance is a table lookup per character rather
// than a bit loop — this runs over every pair in the library.
const NIBBLE_BITS = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

/** Bits that differ between two fingerprints, over all sampled frames. */
export function dhashDistance(a: string, b: string): number {
  if (a.length !== b.length) return Number.MAX_SAFE_INTEGER;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    const x = parseInt(a[i], 16);
    const y = parseInt(b[i], 16);
    if (Number.isNaN(x) || Number.isNaN(y)) return Number.MAX_SAFE_INTEGER;
    distance += NIBBLE_BITS[x ^ y];
  }
  return distance;
}

/** Mean per-channel colour difference, 0-255. */
export function colorDistance(a: string, b: string): number {
  if (a.length !== b.length || a.length === 0) return 255;
  let total = 0;
  let samples = 0;
  for (let i = 0; i < a.length; i += 6) {
    for (let c = 0; c < 3; c++) {
      const x = parseInt(a.slice(i + c * 2, i + c * 2 + 2), 16);
      const y = parseInt(b.slice(i + c * 2, i + c * 2 + 2), 16);
      total += Math.abs(x - y);
      samples++;
    }
  }
  return samples ? total / samples : 255;
}

export interface MatchVerdict {
  /** 0-1, where 1 is an identical progression. */
  similarity: number;
  dhashDistance: number;
  colorDistance: number;
  /** True only when the clips also agree on colour. */
  isDuplicate: boolean;
  /** Same progression, different colour — a greyscale or heavily graded edit. */
  isRecolored: boolean;
}

// Out of 1024 bits, clips that survive a re-encode still land well under 10%
// different; unrelated clips sit near 50%. 12% leaves room for scaling and
// watermarks without pulling in neighbours.
const DHASH_THRESHOLD = 0.12;
// Mean channel difference. Re-encoding shifts colour a little; a greyscale
// edit shifts it a lot.
const COLOR_THRESHOLD = 24;

export function compareFingerprints(
  a: { dhash: string; colors: string },
  b: { dhash: string; colors: string }
): MatchVerdict {
  const bits = a.dhash.length * 4;
  const distance = dhashDistance(a.dhash, b.dhash);
  const colour = colorDistance(a.colors, b.colors);
  const ratio = bits ? distance / bits : 1;
  const sameProgression = ratio <= DHASH_THRESHOLD;

  return {
    similarity: Math.max(0, 1 - ratio),
    dhashDistance: distance,
    colorDistance: Math.round(colour),
    isDuplicate: sameProgression && colour <= COLOR_THRESHOLD,
    isRecolored: sameProgression && colour > COLOR_THRESHOLD,
  };
}
