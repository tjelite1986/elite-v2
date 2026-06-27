import fs from "node:fs";
import path from "node:path";
import semver from "semver";
import { sql } from "kysely";
import { db, AppRow, AppVersionRow } from "../db";
import { qb, getOne, getAll } from "../kysely";
import { STORE_DIR } from "../appstore-storage";
import { verifyApk, VerifyResult } from "../apk-verify";
import { downloadToFile } from "./download";
import * as github from "./github";
import * as fdroid from "./fdroid";
import * as playstore from "./playstore";
import { fetchModSiteVersion } from "./modsites";
import * as apkpure from "./apkpure";

function getApp(appId: number): AppRow | undefined {
  return getOne<AppRow>(
    qb.selectFrom("apps").selectAll().where("id", "=", appId)
  );
}

function meta(app: AppRow): Record<string, unknown> {
  try {
    return app.source_meta ? JSON.parse(app.source_meta) : {};
  } catch {
    return {};
  }
}
function setMeta(appId: number, patch: Record<string, unknown>): void {
  const app = getApp(appId);
  const m = app ? meta(app) : {};
  db.prepare("UPDATE apps SET source_meta = ? WHERE id = ?").run(
    JSON.stringify({ ...m, ...patch }),
    appId
  );
}

// Is `remote` a newer version than `local`? semver-aware with a string fallback.
function isNewerSemver(remote: string, local: string | null): boolean {
  if (!local) return true;
  const r = semver.coerce(remote);
  const l = semver.coerce(local);
  if (r && l) return semver.gt(r, l);
  return remote !== local;
}

// --- Download + verify + promote a specific version (github / fdroid) ---

export async function downloadAndPromote(
  appId: number,
  versionId: number
): Promise<VerifyResult | null> {
  const app = getApp(appId);
  const version = getOne<AppVersionRow>(
    qb
      .selectFrom("app_versions")
      .selectAll()
      .where("id", "=", versionId)
      .where("app_id", "=", appId)
  );
  if (!app || !version || !version.download_url) return null;

  const rawFileName =
    version.file_name ||
    version.download_url.split("/").pop()?.split("?")[0] ||
    `${app.slug}-${version.version}.apk`;
  // basename() so the download target can never escape the app's storage dir,
  // even if a source ever hands us a name with path separators.
  const fileName = path.basename(rawFileName) || `${app.slug}-${version.version}.apk`;
  const destAbs = path.join(STORE_DIR, app.slug, version.version, fileName);

  const headers =
    app.source === "github" && process.env.GITHUB_TOKEN
      ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/octet-stream" }
      : undefined;

  const size = await downloadToFile(version.download_url, destAbs, headers);
  const verify = await verifyApk(destAbs, {
    expectedSha256: version.sha256,
    pinnedSigner: app.signing_cert,
  });

  const apkKey = path.relative(STORE_DIR, destAbs);
  db.prepare(
    `UPDATE app_versions SET apk_key = ?, file_name = ?, file_size = ?,
       storage = 'download', sha256 = ?, verify_status = ?, downloaded_at = datetime('now')
     WHERE id = ?`
  ).run(apkKey, fileName, size, verify.sha256, verify.status, versionId);

  if (verify.status === "hash_mismatch" || verify.status === "signer_mismatch") {
    // Reject: drop the file and flag for admin review; do not promote.
    try {
      fs.unlinkSync(destAbs);
    } catch {
      /* ignore */
    }
    db.prepare(
      "UPDATE app_versions SET apk_key = NULL WHERE id = ?"
    ).run(versionId);
    db.prepare(
      "UPDATE apps SET review_flag = ?, last_checked_at = datetime('now') WHERE id = ?"
    ).run(verify.status, appId);
    return verify;
  }

  // Accept (ok | unverifiable): pin signer on first download, promote.
  const pin =
    !app.signing_cert && verify.signerSha256 ? verify.signerSha256 : app.signing_cert;
  db.prepare("UPDATE app_versions SET is_current = 0 WHERE app_id = ?").run(appId);
  db.prepare("UPDATE app_versions SET is_current = 1 WHERE id = ?").run(versionId);
  db.prepare(
    `UPDATE apps SET current_version = ?, available_version = ?, update_available = 0,
       review_flag = NULL, signing_cert = ?, last_checked_at = datetime('now')
     WHERE id = ?`
  ).run(version.version, version.version, pin, appId);
  return verify;
}

// Approve a new signer after a signer_mismatch (deliberate admin override).
export function approveSigner(appId: number): void {
  const app = getApp(appId);
  if (!app) return;
  const rejected = getOne<AppVersionRow>(
    qb
      .selectFrom("app_versions")
      .selectAll()
      .where("app_id", "=", appId)
      .where("verify_status", "=", "signer_mismatch")
      .orderBy("id", "desc")
      .limit(1)
  );
  // Clear the pin so the next download re-pins to the new signer.
  db.prepare(
    "UPDATE apps SET signing_cert = NULL, review_flag = NULL WHERE id = ?"
  ).run(appId);
  if (rejected) {
    // nothing else to do; admin can re-run Update now.
  }
}

// --- Per-app version check (dispatch by source) ---

export async function checkApp(appId: number): Promise<{
  source: string;
  updateAvailable: boolean;
  version: string | null;
}> {
  const app = getApp(appId);
  if (!app) return { source: "?", updateAvailable: false, version: null };
  db.prepare("UPDATE apps SET last_checked_at = datetime('now') WHERE id = ?").run(appId);

  if (app.source === "github" && app.source_repo) {
    const [owner, repo] = app.source_repo.split("/");
    const release = await github.fetchLatestRelease(owner, repo);
    if (!release || !release.tag) return { source: "github", updateAvailable: false, version: null };
    if (!isNewerSemver(release.tag, app.current_version)) {
      db.prepare("UPDATE apps SET update_available = 0 WHERE id = ?").run(appId);
      return { source: "github", updateAvailable: false, version: release.tag };
    }
    const asset = github.pickApkAsset(release);
    if (!asset) return { source: "github", updateAvailable: false, version: release.tag };
    db.prepare(
      `INSERT OR IGNORE INTO app_versions (app_id, version, apk_key, file_name, file_size, storage, download_url)
       VALUES (?, ?, '', ?, ?, 'download', ?)`
    ).run(appId, release.tag, asset.name, asset.size, asset.url);
    db.prepare(
      "UPDATE apps SET available_version = ?, update_available = 1 WHERE id = ?"
    ).run(release.tag, appId);
    if (app.auto_update) {
      const v = getOne<{ id: number }>(
        qb
          .selectFrom("app_versions")
          .select("id")
          .where("app_id", "=", appId)
          .where("version", "=", release.tag)
      );
      if (v) await downloadAndPromote(appId, v.id);
    }
    return { source: "github", updateAvailable: true, version: release.tag };
  }

  if (app.source === "fdroid" && app.source_package) {
    const { suggested, versions } = await fdroid.fetchVersions(app.source_package);
    const top = versions.find((v) => v.versionCode === suggested) || versions[0];
    if (!top) return { source: "fdroid", updateAvailable: false, version: null };
    const localCode = Number(meta(app).versionCode || 0);
    if (top.versionCode <= localCode) {
      db.prepare("UPDATE apps SET update_available = 0 WHERE id = ?").run(appId);
      return { source: "fdroid", updateAvailable: false, version: top.versionName };
    }
    db.prepare(
      `INSERT OR IGNORE INTO app_versions (app_id, version, apk_key, file_name, file_size, storage, download_url)
       VALUES (?, ?, '', ?, 0, 'download', ?)`
    ).run(
      appId,
      top.versionName,
      `${app.source_package}_${top.versionCode}.apk`,
      fdroid.apkUrl(app.source_package, top.versionCode)
    );
    db.prepare(
      "UPDATE apps SET available_version = ?, update_available = 1 WHERE id = ?"
    ).run(top.versionName, appId);
    setMeta(appId, { availableVersionCode: top.versionCode });
    if (app.auto_update) {
      const v = getOne<{ id: number }>(
        qb
          .selectFrom("app_versions")
          .select("id")
          .where("app_id", "=", appId)
          .where("version", "=", top.versionName)
      );
      if (v) {
        await downloadAndPromote(appId, v.id);
        setMeta(appId, { versionCode: top.versionCode });
      }
    }
    return { source: "fdroid", updateAvailable: true, version: top.versionName };
  }

  if (app.source === "playstore" && app.source_package) {
    // Version-check ONLY — never download.
    const { version, updated } = await playstore.fetchAppVersion(app.source_package);
    if (version && isNewerSemver(version, app.current_version)) {
      db.prepare(
        "UPDATE apps SET available_version = ?, update_available = 1 WHERE id = ?"
      ).run(version, appId);
    } else {
      db.prepare("UPDATE apps SET update_available = 0 WHERE id = ?").run(appId);
    }
    setMeta(appId, { playUpdated: updated, playVersion: version });
    return { source: "playstore", updateAvailable: !!version, version };
  }

  // A non-Play app can have a Play package and/or a latestmodapks page linked
  // for version-check only.
  if (app.play_package) {
    return await checkPlayPackage(appId);
  }
  if (app.modapk_url) {
    return await checkModApk(appId);
  }
  if (app.fdroid_package) {
    return await checkFdroidPackage(appId);
  }
  if (app.apkpure_url) {
    return await checkApkpurePackage(appId);
  }

  return { source: app.source, updateAvailable: false, version: null };
}

// Version-check an app against its linked APKPure page (never downloads).
export async function checkApkpurePackage(appId: number): Promise<{
  source: string;
  updateAvailable: boolean;
  version: string | null;
}> {
  const app = getApp(appId);
  if (!app || !app.apkpure_url) {
    return { source: "apkpure", updateAvailable: false, version: null };
  }
  db.prepare("UPDATE apps SET last_checked_at = datetime('now') WHERE id = ?").run(appId);
  const version = await apkpure.fetchVersion(app.apkpure_url);
  const newer = !!(version && isNewerSemver(version, app.current_version));
  if (newer) {
    db.prepare(
      "UPDATE apps SET available_version = ?, update_available = 1 WHERE id = ?"
    ).run(version, appId);
  } else {
    db.prepare("UPDATE apps SET update_available = 0 WHERE id = ?").run(appId);
  }
  return { source: "apkpure", updateAvailable: newer, version };
}

// Version-check an app against its linked F-Droid package (never downloads).
export async function checkFdroidPackage(appId: number): Promise<{
  source: string;
  updateAvailable: boolean;
  version: string | null;
}> {
  const app = getApp(appId);
  if (!app || !app.fdroid_package) {
    return { source: "fdroid-link", updateAvailable: false, version: null };
  }
  db.prepare("UPDATE apps SET last_checked_at = datetime('now') WHERE id = ?").run(appId);
  const { suggested, versions } = await fdroid.fetchVersions(app.fdroid_package);
  const top = versions.find((v) => v.versionCode === suggested) || versions[0] || null;
  const version = top?.versionName || null;
  const newer = !!(version && isNewerSemver(version, app.current_version));
  if (newer) {
    db.prepare(
      "UPDATE apps SET available_version = ?, update_available = 1 WHERE id = ?"
    ).run(version, appId);
  } else {
    db.prepare("UPDATE apps SET update_available = 0 WHERE id = ?").run(appId);
  }
  return { source: "fdroid-link", updateAvailable: newer, version };
}

// Version-check an app against its linked latestmodapks page (never downloads).
export async function checkModApk(appId: number): Promise<{
  source: string;
  updateAvailable: boolean;
  version: string | null;
}> {
  const app = getApp(appId);
  if (!app || !app.modapk_url) {
    return { source: "modapk", updateAvailable: false, version: null };
  }
  db.prepare("UPDATE apps SET last_checked_at = datetime('now') WHERE id = ?").run(appId);
  const version = await fetchModSiteVersion(app.modapk_url);
  const newer = !!(version && isNewerSemver(version, app.current_version));
  if (newer) {
    db.prepare(
      "UPDATE apps SET available_version = ?, update_available = 1 WHERE id = ?"
    ).run(version, appId);
  } else {
    db.prepare("UPDATE apps SET update_available = 0 WHERE id = ?").run(appId);
  }
  setMeta(appId, { modapkVersion: version });
  return { source: "modapk", updateAvailable: newer, version };
}

// Version-check an app against its linked Play package (never downloads).
export async function checkPlayPackage(appId: number): Promise<{
  source: string;
  updateAvailable: boolean;
  version: string | null;
}> {
  const app = getApp(appId);
  if (!app || !app.play_package) {
    return { source: "play-link", updateAvailable: false, version: null };
  }
  db.prepare("UPDATE apps SET last_checked_at = datetime('now') WHERE id = ?").run(appId);
  const { version, updated } = await playstore.fetchAppVersion(app.play_package);
  const newer = !!(version && isNewerSemver(version, app.current_version));
  if (newer) {
    db.prepare(
      "UPDATE apps SET available_version = ?, update_available = 1 WHERE id = ?"
    ).run(version, appId);
  } else {
    db.prepare("UPDATE apps SET update_available = 0 WHERE id = ?").run(appId);
  }
  setMeta(appId, { playVersion: version, playUpdated: updated });
  return { source: "play-link", updateAvailable: newer, version };
}

// Manual "Update now" for github/fdroid: download newest available + promote,
// then (fdroid) advance the stored versionCode.
export async function updateNow(appId: number): Promise<VerifyResult | null> {
  const app = getApp(appId);
  if (!app) return null;
  const version = getOne<AppVersionRow>(
    qb
      .selectFrom("app_versions")
      .selectAll()
      .where("app_id", "=", appId)
      .where("download_url", "is not", null)
      .orderBy(
        sql`(version = COALESCE((SELECT available_version FROM apps WHERE id = ${appId}), version)) desc`
      )
      .orderBy("id", "desc")
      .limit(1)
  );
  if (!version) return null;
  const result = await downloadAndPromote(appId, version.id);
  if (result && (result.status === "ok" || result.status === "unverifiable")) {
    const m = meta(getApp(appId)!);
    if (app.source === "fdroid" && m.availableVersionCode)
      setMeta(appId, { versionCode: m.availableVersionCode });
  }
  return result;
}

export function setAutoUpdate(appId: number, on: boolean): void {
  db.prepare("UPDATE apps SET auto_update = ? WHERE id = ?").run(on ? 1 : 0, appId);
}

// --- Bulk operations (admin + timer) ---

export async function checkAll(source?: string): Promise<{
  checked: number;
  updates: number;
  errors: number;
}> {
  let q = qb.selectFrom("apps").select("id");
  if (!source || source === "all") {
    q = q.where((eb) =>
      eb.or([
        eb("source", "in", ["github", "fdroid", "playstore"]),
        eb("play_package", "is not", null),
        eb("modapk_url", "is not", null),
        eb("fdroid_package", "is not", null),
        eb("apkpure_url", "is not", null),
      ])
    );
  } else if (source === "playstore") {
    // Play-source apps + apps with a linked Play package.
    q = q.where((eb) =>
      eb.or([eb("source", "=", "playstore"), eb("play_package", "is not", null)])
    );
  } else if (source === "modapk") {
    q = q.where("modapk_url", "is not", null);
  } else {
    q = q.where("source", "=", source);
  }
  const rows = getAll<{ id: number }>(q);
  let updates = 0;
  let errors = 0;
  for (const r of rows) {
    try {
      const res = await checkApp(r.id);
      if (res.updateAvailable) updates++;
    } catch {
      errors++;
    }
  }
  return { checked: rows.length, updates, errors };
}

// Download + promote every downloadable app flagged update_available.
export async function updateAllDownloadable(): Promise<{
  updated: number;
  failed: number;
}> {
  const rows = getAll<{ id: number }>(
    qb
      .selectFrom("apps")
      .select("id")
      .where("source", "in", ["github", "fdroid"])
      .where("update_available", "=", 1)
  );
  let updated = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      const res = await updateNow(r.id);
      if (res && (res.status === "ok" || res.status === "unverifiable")) updated++;
      else failed++;
    } catch {
      failed++;
    }
  }
  return { updated, failed };
}
