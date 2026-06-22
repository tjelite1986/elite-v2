import fs from "node:fs";
import crypto from "node:crypto";

// Lightweight APK verification with no external tooling:
//  - SHA-256 of the whole file (integrity).
//  - The signer certificate's SHA-256 fingerprint, parsed from the APK Signing
//    Block (v2: 0x7109871a, v3: 0xf05368c0). This is the same value apksigner
//    reports and is stable across versions signed with the same key — so it
//    powers trust-on-first-use (TOFU) signer pinning.
// Every parse step is guarded; on any failure the signer fingerprint is null
// ("unverifiable") rather than throwing or silently passing.

const EOCD_SIG = 0x06054b50;
const APK_SIG_BLOCK_MAGIC = Buffer.from("APK Sig Block 42", "latin1");
const ID_V2 = 0x7109871a;
const ID_V3 = 0xf05368c0;

export function computeSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function readWindow(fd: number, start: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  fs.readSync(fd, buf, 0, length, start);
  return buf;
}

// Locate the central-directory offset via the End Of Central Directory record.
function findCdOffset(fd: number, fileSize: number): number | null {
  const maxBack = Math.min(fileSize, 0x10000 + 22);
  const buf = readWindow(fd, fileSize - maxBack, maxBack);
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      const cdOffset = buf.readUInt32LE(i + 16);
      if (cdOffset === 0xffffffff) return null; // ZIP64 unsupported
      return cdOffset;
    }
  }
  return null;
}

// Pull the first X.509 certificate (DER) out of a v2/v3 block value.
function firstCertDer(value: Buffer): Buffer | null {
  try {
    let p = 0;
    p += 4; // uint32 length of signers sequence
    const signerLen = value.readUInt32LE(p);
    p += 4;
    const signer = value.subarray(p, p + signerLen);

    let sp = 0;
    const sdLen = signer.readUInt32LE(sp);
    sp += 4;
    const sd = signer.subarray(sp, sp + sdLen);

    let dp = 0;
    const digestsLen = sd.readUInt32LE(dp);
    dp += 4 + digestsLen;
    const certsLen = sd.readUInt32LE(dp);
    dp += 4;
    const certs = sd.subarray(dp, dp + certsLen);

    const certLen = certs.readUInt32LE(0);
    const certDer = certs.subarray(4, 4 + certLen);
    if (certDer.length !== certLen || certLen === 0) return null;
    return certDer;
  } catch {
    return null;
  }
}

export function extractSignerSha256(filePath: string): string | null {
  let fd: number | null = null;
  try {
    const fileSize = fs.statSync(filePath).size;
    fd = fs.openSync(filePath, "r");

    const cdOffset = findCdOffset(fd, fileSize);
    if (!cdOffset || cdOffset < 24) return null;

    // The trailing [uint64 size][16-byte magic] sit right before the CD.
    const footer = readWindow(fd, cdOffset - 24, 24);
    if (!footer.subarray(8, 24).equals(APK_SIG_BLOCK_MAGIC)) return null;
    const blockSize = Number(footer.readBigUInt64LE(0));
    if (blockSize <= 0 || blockSize > 64 * 1024 * 1024) return null;

    const blockStart = cdOffset - (blockSize + 8);
    if (blockStart < 0) return null;
    const block = readWindow(fd, blockStart, blockSize + 8);

    // Iterate id-value pairs (skip the 8-byte leading size).
    let pos = 8;
    const end = block.length - 24; // before trailing size + magic
    while (pos + 12 <= end) {
      const pairLen = Number(block.readBigUInt64LE(pos));
      if (pairLen < 4 || pos + 8 + pairLen > block.length) break;
      const id = block.readUInt32LE(pos + 8);
      if (id === ID_V2 || id === ID_V3) {
        const value = block.subarray(pos + 12, pos + 8 + pairLen);
        const der = firstCertDer(value);
        if (der) return crypto.createHash("sha256").update(der).digest("hex");
      }
      pos += 8 + pairLen;
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

export type VerifyStatus = "ok" | "hash_mismatch" | "signer_mismatch" | "unverifiable";

export interface VerifyResult {
  status: VerifyStatus;
  sha256: string;
  signerSha256: string | null;
}

// Verify a downloaded APK. expectedSha256 (if known from the source) gates
// integrity; pinnedSigner (if the app already has one) gates the signer (TOFU).
export async function verifyApk(
  filePath: string,
  opts: { expectedSha256?: string | null; pinnedSigner?: string | null }
): Promise<VerifyResult> {
  const sha256 = await computeSha256(filePath);
  if (opts.expectedSha256 && opts.expectedSha256.toLowerCase() !== sha256) {
    return { status: "hash_mismatch", sha256, signerSha256: null };
  }
  const signerSha256 = extractSignerSha256(filePath);
  if (!signerSha256) {
    return { status: "unverifiable", sha256, signerSha256: null };
  }
  if (opts.pinnedSigner && opts.pinnedSigner !== signerSha256) {
    return { status: "signer_mismatch", sha256, signerSha256 };
  }
  return { status: "ok", sha256, signerSha256 };
}
