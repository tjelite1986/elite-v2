import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";

// Read identity out of an APK without external tooling (no aapt): package name,
// versionName and versionCode from the binary AndroidManifest.xml (AXML). The
// zip is read via its central directory with windowed fs reads, so only the
// manifest entry is ever loaded into memory — safe for multi-hundred-MB APKs.
// Split bundles (.xapk/.apks) are handled by extracting the base APK to a temp
// file and parsing that. Every step is guarded; failures yield null fields.

export interface ApkManifestInfo {
  packageName: string | null;
  versionName: string | null;
  versionCode: number | null;
}

const EMPTY: ApkManifestInfo = {
  packageName: null,
  versionName: null,
  versionCode: null,
};

// --- Minimal zip reader (single-entry extraction) ---

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

interface ZipEntry {
  name: string;
  method: number; // 0 = stored, 8 = deflate
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function readWindow(fd: number, start: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  fs.readSync(fd, buf, 0, length, start);
  return buf;
}

function listEntries(fd: number, fileSize: number): ZipEntry[] {
  const maxBack = Math.min(fileSize, 0x10000 + 22);
  const tail = readWindow(fd, fileSize - maxBack, maxBack);
  let cdOffset = -1;
  let cdSize = 0;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIG) {
      cdSize = tail.readUInt32LE(i + 12);
      cdOffset = tail.readUInt32LE(i + 16);
      break;
    }
  }
  // 0xffffffff means ZIP64 — unsupported here.
  if (cdOffset < 0 || cdOffset === 0xffffffff || cdOffset + cdSize > fileSize) {
    return [];
  }
  const cd = readWindow(fd, cdOffset, cdSize);
  const entries: ZipEntry[] = [];
  let p = 0;
  while (p + 46 <= cd.length && cd.readUInt32LE(p) === CD_SIG) {
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    entries.push({
      name: cd.subarray(p + 46, p + 46 + nameLen).toString("utf8"),
      method: cd.readUInt16LE(p + 10),
      compressedSize: cd.readUInt32LE(p + 20),
      uncompressedSize: cd.readUInt32LE(p + 24),
      localHeaderOffset: cd.readUInt32LE(p + 42),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// Data range of an entry (the local header's name/extra lengths can differ from
// the central directory's, so they must be read from the local header).
function entryDataStart(fd: number, entry: ZipEntry): number | null {
  const lh = readWindow(fd, entry.localHeaderOffset, 30);
  if (lh.readUInt32LE(0) !== LOCAL_SIG) return null;
  const nameLen = lh.readUInt16LE(26);
  const extraLen = lh.readUInt16LE(28);
  return entry.localHeaderOffset + 30 + nameLen + extraLen;
}

function readEntryBuffer(
  fd: number,
  entry: ZipEntry,
  maxBytes: number
): Buffer | null {
  if (
    entry.compressedSize > maxBytes ||
    entry.uncompressedSize > maxBytes ||
    entry.compressedSize === 0xffffffff
  ) {
    return null;
  }
  const start = entryDataStart(fd, entry);
  if (start === null) return null;
  const raw = readWindow(fd, start, entry.compressedSize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) {
    try {
      return zlib.inflateRawSync(raw);
    } catch {
      return null;
    }
  }
  return null;
}

async function extractEntryToFile(
  filePath: string,
  fd: number,
  entry: ZipEntry,
  destPath: string
): Promise<void> {
  const start = entryDataStart(fd, entry);
  if (start === null || entry.compressedSize === 0xffffffff) {
    throw new Error("Unsupported zip entry");
  }
  const src = fs.createReadStream(filePath, {
    start,
    end: start + entry.compressedSize - 1,
  });
  const dest = fs.createWriteStream(destPath);
  if (entry.method === 8) {
    await pipeline(src, zlib.createInflateRaw(), dest);
  } else {
    await pipeline(src, dest);
  }
}

// --- Binary XML (AXML) parsing ---

const CHUNK_STRING_POOL = 0x0001;
const CHUNK_XML = 0x0003;
const CHUNK_START_ELEMENT = 0x0102;

function parseStringPool(buf: Buffer, chunkStart: number): string[] {
  const headerSize = buf.readUInt16LE(chunkStart + 2);
  const stringCount = buf.readUInt32LE(chunkStart + 8);
  const flags = buf.readUInt32LE(chunkStart + 16);
  const stringsStart = buf.readUInt32LE(chunkStart + 20);
  const utf8 = (flags & 0x100) !== 0;
  const offsets = chunkStart + headerSize;
  const strings: string[] = [];
  for (let i = 0; i < stringCount; i++) {
    try {
      const off = buf.readUInt32LE(offsets + i * 4);
      let p = chunkStart + stringsStart + off;
      if (utf8) {
        // charLen then byteLen, each u8 with a high-bit length extension.
        const c = buf.readUInt8(p);
        p += c & 0x80 ? 2 : 1;
        let byteLen = buf.readUInt8(p);
        if (byteLen & 0x80) {
          byteLen = ((byteLen & 0x7f) << 8) | buf.readUInt8(p + 1);
          p += 2;
        } else {
          p += 1;
        }
        strings.push(buf.subarray(p, p + byteLen).toString("utf8"));
      } else {
        let len = buf.readUInt16LE(p);
        p += 2;
        if (len & 0x8000) {
          len = ((len & 0x7fff) << 16) | buf.readUInt16LE(p);
          p += 2;
        }
        strings.push(buf.subarray(p, p + len * 2).toString("utf16le"));
      }
    } catch {
      strings.push("");
    }
  }
  return strings;
}

// Parse the <manifest> element's package / versionName / versionCode attributes
// out of a compiled AndroidManifest.xml.
export function parseBinaryManifest(buf: Buffer): ApkManifestInfo {
  const out: ApkManifestInfo = { ...EMPTY };
  try {
    if (buf.length < 8 || buf.readUInt16LE(0) !== CHUNK_XML) return out;
    let strings: string[] = [];
    let pos = 8;
    while (pos + 8 <= buf.length) {
      const type = buf.readUInt16LE(pos);
      const headerSize = buf.readUInt16LE(pos + 2);
      const chunkSize = buf.readUInt32LE(pos + 4);
      if (chunkSize < 8 || pos + chunkSize > buf.length) break;
      if (type === CHUNK_STRING_POOL && !strings.length) {
        strings = parseStringPool(buf, pos);
      } else if (type === CHUNK_START_ELEMENT) {
        // ResXMLTree_attrExt right after the node header: ns(4) name(4)
        // attributeStart(2) attributeSize(2) attributeCount(2) ...
        const body = pos + headerSize;
        const nameIdx = buf.readUInt32LE(body + 4);
        if (strings[nameIdx] === "manifest") {
          const attrStart = buf.readUInt16LE(body + 8);
          const attrSize = buf.readUInt16LE(body + 10);
          const attrCount = buf.readUInt16LE(body + 12);
          for (let i = 0; i < attrCount; i++) {
            // Attribute: ns(4) name(4) rawValue(4) Res_value{size(2) res0(1)
            // dataType(1) data(4)}.
            const a = body + attrStart + i * attrSize;
            if (a + 20 > buf.length) break;
            const attrName = strings[buf.readUInt32LE(a + 4)];
            const rawIdx = buf.readUInt32LE(a + 8);
            const dataType = buf.readUInt8(a + 15);
            const data = buf.readUInt32LE(a + 16);
            const strVal =
              rawIdx !== 0xffffffff
                ? strings[rawIdx]
                : dataType === 3 // TYPE_STRING
                  ? strings[data]
                  : null;
            if (attrName === "package" && strVal) out.packageName = strVal;
            else if (attrName === "versionName" && strVal) out.versionName = strVal;
            else if (attrName === "versionCode" && dataType >= 0x10) {
              out.versionCode = data;
            }
          }
          return out; // manifest attributes live on the root element — done
        }
      }
      pos += chunkSize;
    }
  } catch {
    /* unparseable — return whatever was collected */
  }
  return out;
}

// Prefer the explicit base.apk; otherwise the largest non-split .apk inside a
// bundle (config.* / split_* entries are density/language/ABI splits).
function pickBaseApkEntry(entries: ZipEntry[]): ZipEntry | null {
  const apks = entries.filter((e) => /\.apk$/i.test(e.name));
  if (!apks.length) return null;
  const explicit = apks.find((e) => path.basename(e.name).toLowerCase() === "base.apk");
  if (explicit) return explicit;
  const nonSplit = apks.filter(
    (e) => !/(^|\/)(config[._]|split_)/i.test(path.basename(e.name))
  );
  const pool = nonSplit.length ? nonSplit : apks;
  return pool.reduce((a, b) => (b.uncompressedSize > a.uncompressedSize ? b : a));
}

// Read package/version info from an .apk (or .xapk/.apks bundle, one level of
// nesting). Never throws — unreadable input yields all-null fields.
export async function readApkInfo(filePath: string): Promise<ApkManifestInfo> {
  let fd: number | null = null;
  try {
    const fileSize = fs.statSync(filePath).size;
    fd = fs.openSync(filePath, "r");
    const entries = listEntries(fd, fileSize);
    const manifest = entries.find((e) => e.name === "AndroidManifest.xml");
    if (manifest) {
      const data = readEntryBuffer(fd, manifest, 16 * 1024 * 1024);
      return data ? parseBinaryManifest(data) : { ...EMPTY };
    }
    const inner = pickBaseApkEntry(entries);
    if (!inner) return { ...EMPTY };
    const tmp = path.join(
      os.tmpdir(),
      `apk-info-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.apk`
    );
    try {
      await extractEntryToFile(filePath, fd, inner, tmp);
      return await readApkInfo(tmp);
    } finally {
      fs.rm(tmp, { force: true }, () => {});
    }
  } catch {
    return { ...EMPTY };
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
