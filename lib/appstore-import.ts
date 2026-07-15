import fs from "node:fs";
import path from "node:path";
import semver from "semver";
import { db, AppRow, AppImportReviewRow } from "./db";
import { qb, getOne, getAll } from "./kysely";
import { IMPORT_ROOT } from "./storage-roots";
import { STORE_DIR, storeKey, ensureDir } from "./appstore-storage";
import { slugify } from "./appstore-archive";
import { verifyApk, extractSignerSha256, computeSha256 } from "./apk-verify";
import { readApkInfo } from "./apk-manifest";
import { ingestPlaystore } from "./sources/ingest";

// App Store folder import: APK files dropped in IMPORT_ROOT/appstore are
// matched against the catalog (package id from the manifest is the strongest
// key, then the filename-derived name, with the signing cert as a tiebreak) and
// attached as a new version of the matched app. Anything ambiguous is parked
// under IMPORT_ROOT/_review/appstore with a row in app_import_review for an
// admin decision on the Manage page: attach to a suggested/manually-chosen app,
// create a new app from a Play Store package, create a bare app, or discard.

export const APP_IMPORT_DIR = path.join(IMPORT_ROOT, "appstore");
const REVIEW_DIR = path.join(IMPORT_ROOT, "_review", "appstore");

// A file modified this recently may still be uploading (Samba/SFTP drop).
const QUIET_MS = 60_000;
const APK_EXT = /\.(apk|xapk|apks)$/i;

// --- Filename parsing ---

export interface ParsedApkName {
  name: string;
  version: string | null;
  packageName: string | null;
}

// "CCleaner Pro v26.12.1 - androforever.com.apk" →
//   { name: "CCleaner Pro", version: "26.12.1", packageName: null }
// "com.fikfap.app-4.1.0.apk" →
//   { name: "com fikfap app", version: "4.1.0", packageName: "com.fikfap.app" }
export function parseApkFilename(fileName: string): ParsedApkName {
  let base = fileName.replace(APK_EXT, "").replace(/[_+]/g, " ");

  // A java-style package id needs at least two dots — matched before domain
  // stripping (a one-dot domain like androforever.com never qualifies).
  const pkgMatch = base.match(
    /\b([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){2,})\b/i
  );
  const packageName = pkgMatch ? pkgMatch[1] : null;

  // Strip release-site credits: "- androforever.com", "(modsite.net)", ...
  let cleaned = base;
  if (packageName) cleaned = cleaned.replace(pkgMatch![0], " ");
  cleaned = cleaned.replace(
    /(?:www\.)?[a-z0-9-]{2,}\.(?:com|net|org|io|co|app|win|site|xyz|me|to|cc|dev|info)\b/gi,
    " "
  );

  // Version: prefer an explicit v/version prefix, else a bare dotted number.
  let version: string | null = null;
  let versionIndex = -1;
  // Suffixes are limited to real prerelease tags so decorations like "-mod1"
  // or "-arm64-v8a" never end up in the version string.
  const VER = /(\d+(?:\.\d+)+(?:[.-](?:beta|alpha|rc)\.?\d*)?)/.source;
  const vm =
    cleaned.match(new RegExp(`\\bv(?:ersion)?[ .:_-]?${VER}`, "i")) ||
    cleaned.match(new RegExp(`\\b${VER}\\b`, "i"));
  if (vm) {
    version = vm[1];
    versionIndex = vm.index ?? -1;
  }

  let name = versionIndex > 0 ? cleaned.slice(0, versionIndex) : cleaned;
  if (version) name = name.replace(vm![0], " ");
  name = name
    .replace(/\((?:[^)]*)\)|\[(?:[^\]]*)\]/g, " ") // bracketed release notes
    .replace(/[-–—.,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!name && packageName) name = packageName.replace(/\./g, " ");

  return { name, version, packageName };
}

// --- Name matching ---

// Release-name decorations that say nothing about WHICH app it is.
const NOISE_TOKENS = new Set([
  "pro", "mod", "premium", "apk", "xapk", "unlocked", "unlock", "full",
  "paid", "plus", "vip", "adfree", "ads", "ad", "free", "latest", "version",
  "final", "patched", "cracked", "lite", "beta", "android", "edition", "hack",
  "menu", "mega", "original", "official", "update", "updated", "new",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export interface AppSuggestion {
  appId: number;
  name: string;
  score: number;
  why: string;
}

interface MatchResult {
  auto: AppRow | null;
  autoWhy: string | null;
  suggestions: AppSuggestion[];
}

function matchApps(
  parsedName: string,
  packageName: string | null,
  signer: string | null,
  apps: AppRow[]
): MatchResult {
  // 1) Exact package match — any of the app's known package columns.
  if (packageName) {
    const pkg = packageName.toLowerCase();
    const byPkg = apps.filter((a) =>
      [a.package_name, a.play_package, a.fdroid_package, a.source_package].some(
        (p) => p && p.toLowerCase() === pkg
      )
    );
    if (byPkg.length === 1) {
      return { auto: byPkg[0], autoWhy: "package id", suggestions: [] };
    }
  }

  // 2) Name-token scoring. Noise words (Pro/Mod/Premium/...) are dropped from
  // the drop name so "CCleaner Pro" matches "CCleaner – Phone Cleaner".
  const allDrop = tokenize(parsedName);
  const dropTokens = allDrop.filter((t) => !NOISE_TOKENS.has(t));
  const effective = dropTokens.length ? dropTokens : allDrop;

  const scored = apps
    .map((app) => {
      const appTokens = new Set(tokenize(app.name).concat(tokenize(app.slug)));
      if (!effective.length || !appTokens.size) {
        return { app, coverage: 0, score: 0 };
      }
      const hits = effective.filter((t) => appTokens.has(t)).length;
      const coverage = hits / effective.length;
      const appCoverage = hits / appTokens.size;
      let score = coverage * 0.7 + appCoverage * 0.3;
      if (signer && app.signing_cert === signer) score += 0.25;
      return { app, coverage, score };
    })
    .filter((s) => s.score > 0.15)
    .sort((a, b) => b.score - a.score);

  // Auto only when exactly one app contains every (non-noise) drop token.
  const fullCoverage = scored.filter((s) => s.coverage === 1);
  if (fullCoverage.length === 1) {
    return { auto: fullCoverage[0].app, autoWhy: "name match", suggestions: [] };
  }

  return {
    auto: null,
    autoWhy: null,
    suggestions: scored.slice(0, 5).map((s) => ({
      appId: s.app.id,
      name: s.app.name,
      score: Math.round(s.score * 100) / 100,
      why:
        signer && s.app.signing_cert === signer
          ? "same signing key"
          : "name similarity",
    })),
  };
}

// --- Attach an APK file to an app as a new version ---

function isNewer(candidate: string, current: string | null): boolean {
  if (!current) return true;
  const c = semver.coerce(candidate);
  const l = semver.coerce(current);
  if (c && l) return semver.gt(c, l);
  // Uncomparable — a manual drop is assumed to be the version the user wants.
  return candidate !== current;
}

function sanitizeSegment(s: string): string {
  return s.replace(/[^\w.-]+/g, "_").replace(/^\.+/, "").slice(0, 120) || "x";
}

// Cross-device safe move (IMPORT_ROOT and STORE_DIR are separate bind mounts).
function moveFile(src: string, dest: string): void {
  ensureDir(path.dirname(dest));
  try {
    fs.renameSync(src, dest);
  } catch {
    fs.copyFileSync(src, dest);
    fs.unlinkSync(src);
  }
}

export interface AttachInfo {
  version: string;
  packageName: string | null;
  fileName: string;
}

export interface AttachResult {
  ok: boolean;
  status: string; // verify status or error
  version?: string;
  promoted?: boolean;
  appName?: string;
}

// Verify (TOFU signer pin) + move the file into STORE_DIR + upsert the version
// row; promote to current when the version is newer than what is served.
export async function attachApkToApp(
  appId: number,
  absPath: string,
  info: AttachInfo,
  opts: { force?: boolean } = {}
): Promise<AttachResult> {
  const app = getOne<AppRow>(
    qb.selectFrom("apps").selectAll().where("id", "=", appId)
  );
  if (!app) return { ok: false, status: "app_not_found" };

  const verify = await verifyApk(absPath, {
    pinnedSigner: opts.force ? null : app.signing_cert,
  });
  if (verify.status === "signer_mismatch") {
    return { ok: false, status: "signer_mismatch", appName: app.name };
  }

  const version = info.version;
  const fileName = sanitizeSegment(path.basename(info.fileName));
  const rel = path.join(app.slug, "import", sanitizeSegment(version), fileName);
  const destAbs = path.join(STORE_DIR, rel);
  moveFile(absPath, destAbs);

  const apkKey = storeKey(rel);
  const fileSize = fs.statSync(destAbs).size;
  const existing = getOne<{ id: number }>(
    qb
      .selectFrom("app_versions")
      .select("id")
      .where("app_id", "=", appId)
      .where("version", "=", version)
  );
  let versionId: number;
  if (existing) {
    db.prepare(
      `UPDATE app_versions SET apk_key = ?, file_name = ?, file_size = ?, storage = 'download',
         sha256 = ?, verify_status = ?, downloaded_at = datetime('now') WHERE id = ?`
    ).run(apkKey, fileName, fileSize, verify.sha256, verify.status, existing.id);
    versionId = existing.id;
  } else {
    const r = db
      .prepare(
        `INSERT INTO app_versions (app_id, version, apk_key, file_name, file_size, storage, sha256, verify_status, downloaded_at)
         VALUES (?, ?, ?, ?, ?, 'download', ?, ?, datetime('now'))`
      )
      .run(appId, version, apkKey, fileName, fileSize, verify.sha256, verify.status);
    versionId = Number(r.lastInsertRowid);
  }

  if (info.packageName && !app.package_name) {
    db.prepare("UPDATE apps SET package_name = ? WHERE id = ?").run(
      info.packageName,
      appId
    );
  }

  // Promote when nothing is currently served, or the drop is newer. A force
  // attach after a signer change re-pins to the new signer.
  const servedCurrent = getOne<{ id: number }>(
    qb
      .selectFrom("app_versions")
      .select("id")
      .where("app_id", "=", appId)
      .where("is_current", "=", 1)
      .where("apk_key", "!=", "")
  );
  const promoted = !servedCurrent || isNewer(version, app.current_version);
  if (promoted) {
    const pin =
      opts.force && verify.signerSha256
        ? verify.signerSha256
        : !app.signing_cert && verify.signerSha256
          ? verify.signerSha256
          : app.signing_cert;
    db.prepare("UPDATE app_versions SET is_current = 0 WHERE app_id = ?").run(appId);
    db.prepare("UPDATE app_versions SET is_current = 1 WHERE id = ?").run(versionId);
    const clearUpdateFlag =
      !app.available_version || !isNewer(app.available_version, version);
    db.prepare(
      `UPDATE apps SET current_version = ?, signing_cert = ?, review_flag = NULL,
         update_available = CASE WHEN ? THEN 0 ELSE update_available END
       WHERE id = ?`
    ).run(version, pin, clearUpdateFlag ? 1 : 0, appId);
  }

  return {
    ok: true,
    status: verify.status,
    version,
    promoted,
    appName: app.name,
  };
}

// --- Review queue ---

export interface ReviewFields {
  originalName: string;
  parsedName: string | null;
  parsedVersion: string | null;
  packageName: string | null;
  versionCode: number | null;
  signer: string | null;
  fileSize: number;
  reason: string;
  matchedAppId?: number | null;
  suggestions: AppSuggestion[];
}

function parkForReview(absPath: string, fields: ReviewFields): void {
  ensureDir(REVIEW_DIR);
  try {
    fs.chmodSync(REVIEW_DIR, 0o777);
  } catch {
    /* best effort */
  }
  let destName = path.basename(absPath);
  let dest = path.join(REVIEW_DIR, destName);
  for (let n = 2; fs.existsSync(dest); n++) {
    const ext = path.extname(destName);
    destName = `${path.basename(path.basename(absPath), ext)} (${n})${ext}`;
    dest = path.join(REVIEW_DIR, destName);
  }
  moveFile(absPath, dest);
  db.prepare(
    `INSERT INTO app_import_review
       (file_rel, original_name, parsed_name, parsed_version, package_name,
        version_code, signer_sha256, file_size, reason, matched_app_id, suggestions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    path.relative(IMPORT_ROOT, dest),
    fields.originalName,
    fields.parsedName,
    fields.parsedVersion,
    fields.packageName,
    fields.versionCode,
    fields.signer,
    fields.fileSize,
    fields.reason,
    fields.matchedAppId ?? null,
    JSON.stringify(fields.suggestions)
  );
}

export interface ReviewItem {
  id: number;
  fileRel: string;
  originalName: string;
  parsedName: string | null;
  parsedVersion: string | null;
  packageName: string | null;
  signerSha256: string | null;
  fileSize: number;
  reason: string;
  matchedAppId: number | null;
  suggestions: AppSuggestion[];
  createdAt: string;
}

export function listAppImportReview(): ReviewItem[] {
  const rows = getAll<AppImportReviewRow>(
    qb.selectFrom("app_import_review").selectAll().orderBy("id", "desc")
  );
  return rows.map((r) => {
    let suggestions: AppSuggestion[] = [];
    try {
      suggestions = r.suggestions ? JSON.parse(r.suggestions) : [];
    } catch {
      /* ignore */
    }
    return {
      id: r.id,
      fileRel: r.file_rel,
      originalName: r.original_name,
      parsedName: r.parsed_name,
      parsedVersion: r.parsed_version,
      packageName: r.package_name,
      signerSha256: r.signer_sha256,
      fileSize: r.file_size,
      reason: r.reason,
      matchedAppId: r.matched_app_id,
      suggestions,
      createdAt: r.created_at,
    };
  });
}

// --- Scan run ---

export interface AppImportSummary {
  scanned: number;
  imported: { file: string; app: string; version: string; promoted: boolean }[];
  parked: { file: string; reason: string }[];
  skipped: { file: string; note: string }[];
}

// Only one scan at a time; a second trigger awaits the in-flight run (same
// pattern as the user-folders import).
let importInFlight: Promise<AppImportSummary> | null = null;

export async function runAppstoreImport(): Promise<AppImportSummary> {
  if (importInFlight) return importInFlight;
  importInFlight = runAppstoreImportInner().finally(() => {
    importInFlight = null;
  });
  return importInFlight;
}

async function runAppstoreImportInner(): Promise<AppImportSummary> {
  const res: AppImportSummary = {
    scanned: 0,
    imported: [],
    parked: [],
    skipped: [],
  };
  ensureDir(APP_IMPORT_DIR);
  try {
    fs.chmodSync(APP_IMPORT_DIR, 0o777);
  } catch {
    /* best effort — Samba drops need other-uid write */
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(APP_IMPORT_DIR, { withFileTypes: true });
  } catch {
    return res;
  }

  const apps = getAll<AppRow>(qb.selectFrom("apps").selectAll());

  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith(".")) continue;
    const abs = path.join(APP_IMPORT_DIR, entry.name);
    res.scanned++;

    if (!APK_EXT.test(entry.name)) {
      res.skipped.push({ file: entry.name, note: "not an APK file" });
      continue;
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    if (Date.now() - stat.mtimeMs < QUIET_MS) {
      res.skipped.push({ file: entry.name, note: "still being written" });
      continue;
    }

    const manifest = await readApkInfo(abs);
    const parsed = parseApkFilename(entry.name);
    const signer = extractSignerSha256(abs);
    const packageName = manifest.packageName || parsed.packageName;
    const version =
      manifest.versionName ||
      parsed.version ||
      (manifest.versionCode ? `vc${manifest.versionCode}` : null) ||
      `import-${new Date().toISOString().slice(0, 10)}`;

    const match = matchApps(parsed.name, packageName, signer, apps);

    if (!match.auto) {
      parkForReview(abs, {
        originalName: entry.name,
        parsedName: parsed.name || null,
        parsedVersion: version,
        packageName,
        versionCode: manifest.versionCode,
        signer,
        fileSize: stat.size,
        reason: match.suggestions.length ? "ambiguous" : "no_match",
        suggestions: match.suggestions,
      });
      res.parked.push({
        file: entry.name,
        reason: match.suggestions.length
          ? `ambiguous — ${match.suggestions.length} candidate(s)`
          : "no matching app",
      });
      continue;
    }

    const app = match.auto;

    // Same version already served with an identical file → consume the drop.
    const existingVersion = getOne<{ id: number; sha256: string | null; apk_key: string }>(
      qb
        .selectFrom("app_versions")
        .select(["id", "sha256", "apk_key"])
        .where("app_id", "=", app.id)
        .where("version", "=", version)
    );
    if (existingVersion && existingVersion.apk_key) {
      const dropSha = await computeSha256(abs);
      if (existingVersion.sha256 && existingVersion.sha256 === dropSha) {
        fs.unlinkSync(abs);
        res.skipped.push({
          file: entry.name,
          note: `already in store (${app.name} ${version})`,
        });
        continue;
      }
      parkForReview(abs, {
        originalName: entry.name,
        parsedName: parsed.name || null,
        parsedVersion: version,
        packageName,
        versionCode: manifest.versionCode,
        signer,
        fileSize: stat.size,
        reason: "duplicate",
        matchedAppId: app.id,
        suggestions: [
          { appId: app.id, name: app.name, score: 1, why: match.autoWhy || "match" },
        ],
      });
      res.parked.push({
        file: entry.name,
        reason: `version ${version} of ${app.name} already exists with different content`,
      });
      continue;
    }

    const attach = await attachApkToApp(app.id, abs, {
      version,
      packageName,
      fileName: entry.name,
    });
    if (!attach.ok) {
      parkForReview(abs, {
        originalName: entry.name,
        parsedName: parsed.name || null,
        parsedVersion: version,
        packageName,
        versionCode: manifest.versionCode,
        signer,
        fileSize: stat.size,
        reason: "signer_mismatch",
        matchedAppId: app.id,
        suggestions: [
          { appId: app.id, name: app.name, score: 1, why: match.autoWhy || "match" },
        ],
      });
      res.parked.push({
        file: entry.name,
        reason: `signer mismatch against ${app.name} — held for review`,
      });
      continue;
    }
    res.imported.push({
      file: entry.name,
      app: app.name,
      version,
      promoted: !!attach.promoted,
    });
  }

  return res;
}

// --- Review decisions ---

function uniqueSlug(base: string): string {
  let slug = slugify(base) || "app";
  let n = 2;
  while (getOne(qb.selectFrom("apps").select("id").where("slug", "=", slug))) {
    slug = `${slugify(base) || "app"}-${n++}`;
  }
  return slug;
}

export type ReviewAction = "attach" | "create-play" | "create-new" | "discard";

export interface DecideResult {
  ok: boolean;
  error?: string;
  signerMismatch?: boolean;
  appId?: number;
  appName?: string;
  version?: string;
}

export async function decideAppImport(
  reviewId: number,
  action: ReviewAction,
  opts: { appId?: number; packageId?: string; force?: boolean } = {}
): Promise<DecideResult> {
  const row = getOne<AppImportReviewRow>(
    qb.selectFrom("app_import_review").selectAll().where("id", "=", reviewId)
  );
  if (!row) return { ok: false, error: "Review item not found" };

  const abs = path.join(IMPORT_ROOT, row.file_rel);
  const removeRow = () =>
    db.prepare("DELETE FROM app_import_review WHERE id = ?").run(reviewId);

  if (action === "discard") {
    try {
      fs.unlinkSync(abs);
    } catch {
      /* already gone */
    }
    removeRow();
    return { ok: true };
  }

  if (!fs.existsSync(abs)) {
    removeRow();
    return { ok: false, error: "The parked file is gone — item removed" };
  }

  const info: AttachInfo = {
    version: row.parsed_version || "unknown",
    packageName: row.package_name,
    fileName: row.original_name,
  };

  let appId = opts.appId;

  if (action === "create-play") {
    if (!opts.packageId) return { ok: false, error: "Play package id required" };
    appId = await ingestPlaystore(opts.packageId);
  } else if (action === "create-new") {
    const name = (row.parsed_name || row.original_name.replace(APK_EXT, "")).trim();
    const r = db
      .prepare(
        `INSERT INTO apps (slug, name, category, section, source, package_name, current_version)
         VALUES (?, ?, 'App', 'apps', 'import', ?, NULL)`
      )
      .run(uniqueSlug(name), name, row.package_name);
    appId = Number(r.lastInsertRowid);
  }

  if (!appId) return { ok: false, error: "Target app required" };

  const attach = await attachApkToApp(appId, abs, info, { force: opts.force });
  if (!attach.ok) {
    if (attach.status === "signer_mismatch") {
      return {
        ok: false,
        signerMismatch: true,
        appName: attach.appName,
        error: `Signed with a different key than the one pinned for ${attach.appName}`,
      };
    }
    return { ok: false, error: `Attach failed (${attach.status})` };
  }
  removeRow();
  return {
    ok: true,
    appId,
    appName: attach.appName,
    version: attach.version,
  };
}
