// Shared image duplicate-detection primitives for the posts and gallery
// scanners. Two-stage matching:
//   1. dHash (cheap, coarse) proposes CANDIDATE pairs — high recall, low
//      precision. A 9x8 thumbnail collapses burst frames (eyes open vs closed)
//      onto near-identical hashes, so a small Hamming distance only means
//      "worth a closer look", never "duplicate".
//   2. SSIM on the ACTUAL decoded pixels confirms a candidate. Structural
//      similarity is sensitive to the local differences a global hash throws
//      away, so a re-compressed/re-cropped copy scores ~1.0 while a
//      same-shoot-different-moment frame drops well below the confirm bar.
//
// Exact sha256 matches never go through this — they are byte-identical and
// always duplicates.

import sharp from "sharp";

// Max Hamming distance (64-bit dHash) for a pair to become a CANDIDATE. Kept
// permissive on purpose: SSIM is the real decision, this only limits how many
// pairs get the expensive pixel comparison.
export const HASH_TOL = 12;

// Structural confirmation bar. A candidate pair is a duplicate only when the
// mean windowed SSIM of their grayscale renders is at least this. 0.93 at
// SSIM_SIZE=128 is deliberately strict: a re-encode of the SAME photo stays
// ~0.99, while a different-but-similar frame (same pose, eyes open vs closed,
// or a near-identical shot) drops to ~0.76-0.92 once compared at this
// resolution. A coarser 64px render inflated those non-duplicates into the
// 0.90-0.97 range and produced false matches; 128px pulls them apart.
export const SSIM_CONFIRM = 0.93;

const GRAY_SAT = 14; // mean (max-min) channel spread below this = grayscale

// Coarse 64-bit dHash + grayscale flag from a 9x8 sRGB thumbnail. Returns null
// on decode failure.
export async function imageFingerprint(filePath) {
  let buf;
  try {
    buf = await sharp(filePath)
      .resize(9, 8, { fit: "fill" })
      .toColourspace("srgb")
      .removeAlpha()
      .raw()
      .toBuffer();
  } catch {
    return null;
  }
  if (!buf || buf.length < 9 * 8 * 3) return null;
  const lum = new Array(72);
  let satSum = 0;
  for (let p = 0; p < 72; p++) {
    const r = buf[p * 3], g = buf[p * 3 + 1], b = buf[p * 3 + 2];
    lum[p] = 0.299 * r + 0.587 * g + 0.114 * b;
    satSum += Math.max(r, g, b) - Math.min(r, g, b);
  }
  let bits = 0n;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const i = row * 9 + col;
      bits <<= 1n;
      if (lum[i] < lum[i + 1]) bits |= 1n;
    }
  }
  return { hash: bits, gray: satSum / 72 < GRAY_SAT ? 1 : 0 };
}

export function popcount(x) {
  let count = 0n;
  while (x > 0n) {
    count += x & 1n;
    x >>= 1n;
  }
  return Number(count);
}

export const hamming = (a, b) => popcount(a ^ b);

// Side length of the grayscale render used for SSIM. 128x128 in 8x8 windows
// (256 windows) resolves local differences — a face, a changed expression, a
// small edit — into enough windows that a non-duplicate's SSIM drops clearly
// below a re-encode's. A coarser 64px render blurred those differences away and
// scored distinct photos as high as 0.97, causing false matches.
const SSIM_SIZE = 128;
const WIN = 8;

// Decode one image to a flat SSIM_SIZE*SSIM_SIZE grayscale Uint8Array. Returns
// null on decode failure. Callers should compute this once per image and cache.
export async function structuralSignature(filePath) {
  try {
    const buf = await sharp(filePath)
      .resize(SSIM_SIZE, SSIM_SIZE, { fit: "fill" })
      .greyscale()
      .removeAlpha()
      .raw()
      .toBuffer();
    if (!buf || buf.length < SSIM_SIZE * SSIM_SIZE) return null;
    // sharp may keep 1 channel for greyscale; take the first channel per pixel.
    const stride = Math.floor(buf.length / (SSIM_SIZE * SSIM_SIZE));
    if (stride === 1) return new Uint8Array(buf.buffer, buf.byteOffset, SSIM_SIZE * SSIM_SIZE);
    const out = new Uint8Array(SSIM_SIZE * SSIM_SIZE);
    for (let i = 0; i < out.length; i++) out[i] = buf[i * stride];
    return out;
  } catch {
    return null;
  }
}

// Mean windowed SSIM (0..1) between two SSIM_SIZE^2 grayscale signatures.
// Higher = more structurally identical; ~1.0 for a re-encode of the same photo.
export function ssim(a, b) {
  if (!a || !b) return 0;
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  const n = WIN * WIN;
  let sum = 0;
  let windows = 0;
  for (let wy = 0; wy < SSIM_SIZE; wy += WIN) {
    for (let wx = 0; wx < SSIM_SIZE; wx += WIN) {
      let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
      for (let y = 0; y < WIN; y++) {
        const row = (wy + y) * SSIM_SIZE + wx;
        for (let x = 0; x < WIN; x++) {
          const va = a[row + x];
          const vb = b[row + x];
          sa += va; sb += vb;
          saa += va * va; sbb += vb * vb; sab += va * vb;
        }
      }
      const ma = sa / n;
      const mb = sb / n;
      const va = saa / n - ma * ma;
      const vb = sbb / n - mb * mb;
      const cov = sab / n - ma * mb;
      const s =
        ((2 * ma * mb + C1) * (2 * cov + C2)) /
        ((ma * ma + mb * mb + C1) * (va + vb + C2));
      sum += s;
      windows++;
    }
  }
  return windows ? sum / windows : 0;
}
