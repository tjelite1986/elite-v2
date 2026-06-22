import fs from "node:fs";
import path from "node:path";

// Root of the on-disk app archive (moved from the old elite tree into elite-v2's
// own data area). Each app/game is a folder with version subfolders holding the
// APK and an assets/ folder (info.md + logo/banner/screenshots). In Docker this
// path is bind-mounted into the container.
export const APPSTORE_ROOT =
  process.env.APPSTORE_ROOT || "/mnt/4tb/elitev2/appstore";

export type AppSection = "apps" | "games";

export interface ScannedVersion {
  version: string;
  apkKey: string; // path relative to APPSTORE_ROOT
  fileName: string;
  fileSize: number;
  mtimeMs: number;
}

export interface ScannedApp {
  slug: string;
  name: string;
  developer: string | null;
  category: string;
  section: AppSection;
  tagline: string | null;
  description: string | null;
  website: string | null;
  tags: string[];
  isAdult: boolean;
  iconKey: string | null;
  bannerKey: string | null;
  screenshots: string[]; // keys relative to APPSTORE_ROOT
  versions: ScannedVersion[];
}

// Folder names that are adult regardless of their info.md category. The category
// field is unreliable here (some are mislabeled "Tools"/"Productivity").
const ADULT_DIRS = new Set([
  "FikFap",
  "Porn Total",
  "TikPorn",
  "XNXX",
  "hot51",
  "FreeReels",
]);

// Folders inside an app dir that are NOT version folders.
const NON_VERSION_DIRS = new Set(["assets", "plugins"]);

const APK_RE = /\.apk$/i;
const IMG_RE = /\.(png|jpe?g|webp)$/i;

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "app"
  );
}

// Minimal YAML frontmatter parser for the info.md format used by the archive.
// Handles `key: value`, quoted values, folded block scalars (`>-`) and a `tags:`
// list of `- item` lines. Not a general YAML parser — just this shape.
function parseFrontmatter(text: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  const fm = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fm) return out;
  const lines = fm[1].split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1];
    let rest = m[2];

    // tags: list on following indented "- item" lines
    if (key === "tags" && rest.trim() === "") {
      const tags: string[] = [];
      i++;
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        tags.push(lines[i].replace(/^\s*-\s+/, "").trim());
        i++;
      }
      out.tags = tags;
      continue;
    }

    // Folded/literal block scalar: collect indented continuation lines.
    if (rest.trim() === ">-" || rest.trim() === ">" || rest.trim() === "|") {
      const parts: string[] = [];
      i++;
      while (i < lines.length && /^\s+\S/.test(lines[i])) {
        parts.push(lines[i].trim());
        i++;
      }
      out[key] = parts.join(" ");
      continue;
    }

    // Strip surrounding quotes.
    rest = rest.trim().replace(/^['"]|['"]$/g, "");
    out[key] = rest;
    i++;
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

function str(v: string | string[] | undefined): string | null {
  if (v == null) return null;
  const s = Array.isArray(v) ? v.join(", ") : v;
  const t = decodeEntities(s).trim();
  return t.length ? t : null;
}

function scanApp(
  section: AppSection,
  dirName: string,
  dirAbs: string
): ScannedApp | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return null;
  }

  const assetsAbs = path.join(dirAbs, "assets");
  const rel = (abs: string) => path.relative(APPSTORE_ROOT, abs);

  // Metadata
  let meta: Record<string, string | string[]> = {};
  const infoPath = path.join(assetsAbs, "info.md");
  if (fs.existsSync(infoPath)) {
    try {
      meta = parseFrontmatter(fs.readFileSync(infoPath, "utf8"));
    } catch {
      meta = {};
    }
  }

  // Icon + banner
  let iconKey: string | null = null;
  let bannerKey: string | null = null;
  for (const name of ["logo.png", "logo.jpg", "icon.png"]) {
    const p = path.join(assetsAbs, name);
    if (fs.existsSync(p)) {
      iconKey = rel(p);
      break;
    }
  }
  for (const name of ["banner.png", "banner.jpg", "feature.png"]) {
    const p = path.join(assetsAbs, name);
    if (fs.existsSync(p)) {
      bannerKey = rel(p);
      break;
    }
  }

  // Screenshots
  const screenshots: string[] = [];
  const shotsDir = path.join(assetsAbs, "screenshots");
  if (fs.existsSync(shotsDir)) {
    try {
      const shots = fs
        .readdirSync(shotsDir)
        .filter((f) => IMG_RE.test(f))
        .sort();
      for (const f of shots) screenshots.push(rel(path.join(shotsDir, f)));
    } catch {
      /* ignore */
    }
  }

  // Versions: each non-asset subfolder holding an apk.
  const versions: ScannedVersion[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || NON_VERSION_DIRS.has(e.name)) continue;
    const versionAbs = path.join(dirAbs, e.name);
    let apk: string | null = null;
    try {
      apk = fs.readdirSync(versionAbs).find((f) => APK_RE.test(f)) || null;
    } catch {
      apk = null;
    }
    if (!apk) continue;
    const apkAbs = path.join(versionAbs, apk);
    let size = 0;
    let mtimeMs = 0;
    try {
      const st = fs.statSync(apkAbs);
      size = st.size;
      mtimeMs = st.mtimeMs;
    } catch {
      /* ignore */
    }
    versions.push({
      version: e.name,
      apkKey: rel(apkAbs),
      fileName: apk,
      fileSize: size,
      mtimeMs,
    });
  }
  // Newest APK first so the most recently added build is the current version.
  versions.sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (versions.length === 0 && screenshots.length === 0 && !iconKey) {
    // Nothing useful in this folder.
    return null;
  }

  const category = str(meta.category) || (section === "games" ? "Games" : "App");
  const isAdult =
    section === "apps" &&
    (ADULT_DIRS.has(dirName) ||
      /adult/i.test(category) ||
      (Array.isArray(meta.tags) &&
        meta.tags.some((t) => /adult/i.test(String(t)))));

  return {
    slug: slugify(`${dirName}${section === "games" ? "-game" : ""}`),
    name: str(meta.name) || dirName,
    developer: str(meta.developer),
    category,
    section,
    tagline: str(meta.tagline),
    description: str(meta.description),
    website: str(meta.website),
    tags: Array.isArray(meta.tags)
      ? meta.tags.map((t) => decodeEntities(String(t)).trim()).filter(Boolean)
      : [],
    isAdult,
    iconKey,
    bannerKey,
    screenshots,
    versions,
  };
}

// Scan the whole archive (apps/ + games/). Reads small metadata files only, not
// APK bytes, so it is cheap enough to run once on an empty catalog.
export function scanArchive(): ScannedApp[] {
  if (!fs.existsSync(APPSTORE_ROOT)) return [];
  const out: ScannedApp[] = [];
  const seen = new Set<string>();
  for (const section of ["apps", "games"] as AppSection[]) {
    const sectionAbs = path.join(APPSTORE_ROOT, section);
    if (!fs.existsSync(sectionAbs)) continue;
    let dirs: string[];
    try {
      dirs = fs.readdirSync(sectionAbs);
    } catch {
      continue;
    }
    for (const dirName of dirs) {
      const dirAbs = path.join(sectionAbs, dirName);
      let isDir = false;
      try {
        isDir = fs.statSync(dirAbs).isDirectory();
      } catch {
        isDir = false;
      }
      if (!isDir) continue;
      const app = scanApp(section, dirName, dirAbs);
      if (!app) continue;
      // Guard against slug collisions across sections.
      let slug = app.slug;
      let n = 2;
      while (seen.has(slug)) slug = `${app.slug}-${n++}`;
      seen.add(slug);
      app.slug = slug;
      out.push(app);
    }
  }
  return out;
}

// Resolve a stored asset/apk key to an absolute path, refusing anything that
// escapes the archive root (path traversal guard).
export function resolveArchivePath(key: string): string | null {
  if (!key) return null;
  const abs = path.resolve(APPSTORE_ROOT, key);
  const rootWithSep = APPSTORE_ROOT.endsWith(path.sep)
    ? APPSTORE_ROOT
    : APPSTORE_ROOT + path.sep;
  if (abs !== APPSTORE_ROOT && !abs.startsWith(rootWithSep)) return null;
  if (!fs.existsSync(abs)) return null;
  return abs;
}

export function contentTypeForImage(key: string): string {
  if (/\.png$/i.test(key)) return "image/png";
  if (/\.webp$/i.test(key)) return "image/webp";
  return "image/jpeg";
}
