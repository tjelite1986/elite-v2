#!/usr/bin/env node
// Normalize image files in the per-user import drop tree (<IMPORT_ROOT>/u_<user>/)
// so the folder import never chokes on them. Runs INSIDE the elitev2 container
// (Admin -> Background jobs, or `docker exec`); it can also run on the host with
// IMPORT_ROOT pointed at the bind-mounted tree (conversion needs heif-convert).
//
// Two problems it fixes, both byte-sniffed (never trust the extension):
//   1. Real HEIC/HEIF images (any extension) -> converted to JPEG via
//      heif-convert, original deleted. sharp's bundled libvips can't decode
//      HEIF, so unconverted files fail the posts/gallery import.
//   2. Mislabeled downloads (JPEG/PNG/WebP/GIF bytes behind a .heic/.heif
//      extension — gallery-dl does this for Instagram photos) -> renamed to the
//      extension matching their bytes. Feeding them to heif-convert fails.
//
// Optional relocation (--relocate-photos): photos sitting in a shorts/ section
// are video-only territory — the shorts importer skips images silently, so they
// sit in the drop tree forever. The flag moves them (with any .md sidecar) to
// posts/<same subfolder>, where a subfolder names the same creator profile.
// shorts18/ photos are NEVER relocated automatically: the posts importer has no
// 18+ gate, so moving them would publish adult images as public posts. They are
// counted and listed instead so the operator can decide.
//
// Flags: --dry-run (report only), --relocate-photos (see above).
// Output: human log lines + a final `RESULT {json}` line the API route parses.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "/app/data";
const IMPORT_ROOT = process.env.IMPORT_ROOT || path.join(DATA_DIR, "_import");

const DRY_RUN = process.argv.includes("--dry-run");
const RELOCATE = process.argv.includes("--relocate-photos");

const SECTIONS = ["gallery", "posts", "shorts", "shorts18"];

const log = (m) => console.log(`[normalize-import] ${m}`);

// ISO-BMFF `ftyp` brands that mean "a HEIF container sharp cannot decode".
const HEIF_BRANDS = new Set([
  "heic", "heix", "hevc", "heim", "heis", "hevm", "hevs", "mif1", "msf1", "heif",
]);

// Sniff the real format from the first bytes. Returns the canonical extension
// ("jpg" | "png" | "webp" | "gif" | "heif") or null for anything else (videos,
// markdown sidecars, unknown blobs) which the script must not touch.
function sniffKind(absPath) {
  let fd;
  try {
    fd = fs.openSync(absPath, "r");
    const buf = Buffer.alloc(12);
    const read = fs.readSync(fd, buf, 0, 12, 0);
    if (read < 12) return null;
    if (buf[0] === 0xff && buf[1] === 0xd8) return "jpg";
    if (buf.readUInt32BE(0) === 0x89504e47) return "png";
    if (buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "webp";
    if (buf.toString("latin1", 0, 4) === "GIF8") return "gif";
    if (buf.toString("latin1", 4, 8) === "ftyp" && HEIF_BRANDS.has(buf.toString("latin1", 8, 12))) return "heif";
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// Extensions that already correctly describe a sniffed kind.
const OK_EXTS = {
  jpg: new Set([".jpg", ".jpeg"]),
  png: new Set([".png"]),
  webp: new Set([".webp"]),
  gif: new Set([".gif"]),
};

// Pick a destination path that doesn't exist yet: "<stem>.jpg",
// "<stem> (2).jpg", ... Keeps the stem intact so [bracket] tokens survive.
function uniquePath(dir, stem, ext) {
  let candidate = path.join(dir, `${stem}${ext}`);
  for (let n = 2; fs.existsSync(candidate); n++) {
    candidate = path.join(dir, `${stem} (${n})${ext}`);
  }
  return candidate;
}

function convertHeif(absPath, res) {
  const dir = path.dirname(absPath);
  const stem = path.basename(absPath, path.extname(absPath));
  const dest = uniquePath(dir, stem, ".jpg");
  if (DRY_RUN) {
    log(`would convert: ${absPath} -> ${path.basename(dest)}`);
    res.converted++;
    return absPath;
  }
  // Convert into a temp name in the SAME directory, then rename into place, so
  // a concurrent import sweep never sees a half-written JPEG under a final name.
  const tmp = path.join(dir, `.heifconv-${process.pid}-${Date.now()}.jpg`);
  try {
    execFileSync("heif-convert", ["-q", "92", absPath, tmp], { stdio: "ignore" });
    fs.renameSync(tmp, dest);
    fs.unlinkSync(absPath);
    log(`converted: ${absPath} -> ${path.basename(dest)}`);
    res.converted++;
    return dest;
  } catch (err) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* best effort */
    }
    res.errors.push(`${absPath}: heif-convert failed (${String(err.message || err).slice(0, 120)})`);
    return absPath;
  }
}

function fixExtension(absPath, kind, res) {
  const ext = path.extname(absPath).toLowerCase();
  // Only correct the known-bad case: image bytes hiding behind .heic/.heif.
  // A .jpg that is really PNG etc. decodes fine (sharp sniffs content).
  if (ext !== ".heic" && ext !== ".heif") return absPath;
  const dir = path.dirname(absPath);
  const stem = path.basename(absPath, path.extname(absPath));
  const dest = uniquePath(dir, stem, `.${kind}`);
  if (DRY_RUN) {
    log(`would rename: ${absPath} -> ${path.basename(dest)}`);
    res.renamed++;
    return absPath;
  }
  fs.renameSync(absPath, dest);
  log(`renamed: ${absPath} -> ${path.basename(dest)}`);
  res.renamed++;
  return dest;
}

const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm", ".m4v", ".3gp", ".avi", ".mkv"]);

// A same-stem video next to an image marks the image as that clip's poster
// sidecar — it must stay with its video, not be relocated as a photo.
function isPosterSidecar(absPath) {
  const dir = path.dirname(absPath);
  const stem = path.basename(absPath, path.extname(absPath));
  const webStem = stem.toLowerCase().endsWith(".web") ? stem.slice(0, -".web".length) : stem;
  for (const ext of VIDEO_EXTS) {
    if (fs.existsSync(path.join(dir, `${stem}${ext}`)) || fs.existsSync(path.join(dir, `${webStem}${ext}`))) {
      return true;
    }
  }
  return fs.existsSync(path.join(dir, `${stem}.web.mp4`));
}

// Move a normalized photo (and its .md sidecar) out of a video-only shorts/
// section into the posts/ section, preserving the creator subfolder.
function relocateToPosts(absPath, userDir, collection, res) {
  const destDir = collection ? path.join(userDir, "posts", collection) : path.join(userDir, "posts");
  const name = path.basename(absPath);
  if (DRY_RUN) {
    log(`would relocate: ${absPath} -> ${path.relative(userDir, path.join(destDir, name))}`);
    res.relocated++;
    return;
  }
  fs.mkdirSync(destDir, { recursive: true });
  const stem = path.basename(name, path.extname(name));
  const dest = uniquePath(destDir, stem, path.extname(name));
  fs.renameSync(absPath, dest);
  const sidecar = path.join(path.dirname(absPath), `${stem}.md`);
  if (fs.existsSync(sidecar)) {
    fs.renameSync(sidecar, uniquePath(destDir, stem, ".md"));
  }
  log(`relocated: ${absPath} -> ${path.relative(userDir, dest)}`);
  res.relocated++;
}

// Loose files plus one level of subfolders — the same shape lib/user-import.ts
// sweeps, so everything this script can see the importer can see too.
function* walkSection(sectionDir) {
  let entries;
  try {
    entries = fs.readdirSync(sectionDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const abs = path.join(sectionDir, e.name);
    if (e.isFile()) {
      yield { abs, collection: null };
    } else if (e.isDirectory()) {
      let inner;
      try {
        inner = fs.readdirSync(abs, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const f of inner) {
        if (f.name.startsWith(".") || !f.isFile()) continue;
        yield { abs: path.join(abs, f.name), collection: e.name };
      }
    }
  }
}

const res = {
  scanned: 0,
  converted: 0,
  renamed: 0,
  relocated: 0,
  stuckShortsPhotos: 0,
  stuckAdultPhotos: 0,
  errors: [],
};

let userDirs = [];
try {
  userDirs = fs
    .readdirSync(IMPORT_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("u_"))
    .map((e) => path.join(IMPORT_ROOT, e.name));
} catch (err) {
  console.error(`[normalize-import] cannot read IMPORT_ROOT ${IMPORT_ROOT}: ${err.message}`);
  process.exit(1);
}

for (const userDir of userDirs) {
  for (const section of SECTIONS) {
    const sectionDir = path.join(userDir, section);
    for (const item of walkSection(sectionDir)) {
      res.scanned++;
      const kind = sniffKind(item.abs);
      if (!kind) continue;

      let current = item.abs;
      if (kind === "heif") {
        current = convertHeif(current, res);
        if (current === item.abs && !DRY_RUN) continue; // conversion failed
      } else if (OK_EXTS[kind] && !OK_EXTS[kind].has(path.extname(current).toLowerCase())) {
        current = fixExtension(current, kind, res);
      }

      // Photos in a shorts section are never imported (video-only sweep) —
      // unless they are a clip's poster sidecar, which must stay put.
      if (section === "shorts" && !isPosterSidecar(current)) {
        if (RELOCATE) {
          relocateToPosts(current, userDir, item.collection, res);
        } else {
          res.stuckShortsPhotos++;
          log(`photo stuck in video-only section (use --relocate-photos): ${current}`);
        }
      } else if (section === "shorts18" && !isPosterSidecar(current)) {
        res.stuckAdultPhotos++;
        log(`left in place (18+, needs manual routing): ${current}`);
      }
    }
  }
}

log(
  `done: scanned=${res.scanned} converted=${res.converted} renamed=${res.renamed}` +
    ` relocated=${res.relocated} stuckShortsPhotos=${res.stuckShortsPhotos}` +
    ` stuckAdultPhotos=${res.stuckAdultPhotos} errors=${res.errors.length}` +
    (DRY_RUN ? " (dry run)" : "")
);
for (const e of res.errors) log(`ERROR ${e}`);
console.log(`RESULT ${JSON.stringify(res)}`);
