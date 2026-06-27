import path from "node:path";
import { db, AppRow } from "../db";
import { qb, getOne } from "../kysely";
import { STORE_DIR, storeKey } from "../appstore-storage";
import { slugify } from "../appstore-archive";
import { safeHttpUrl } from "../url";
import { downloadImage } from "./download";
import { downloadAndPromote, checkPlayPackage, checkModApk, checkFdroidPackage } from "./updater";
import { fetchModSiteMeta } from "./modsites";
import { impersonateDownload } from "./impersonate";
import * as github from "./github";
import * as fdroid from "./fdroid";
import * as playstore from "./playstore";

function uniqueSlug(base: string): string {
  let slug = slugify(base);
  let n = 2;
  while (
    getOne(qb.selectFrom("apps").select("id").where("slug", "=", slug))
  ) {
    slug = `${slugify(base)}-${n++}`;
  }
  return slug;
}

interface UpsertInput {
  source: "github" | "fdroid" | "playstore";
  matchColumn: "source_repo" | "source_package";
  matchValue: string;
  name: string;
  developer: string | null;
  tagline: string | null;
  description: string | null;
  category: string;
  website: string | null;
  homepage: string | null;
  iconKey: string | null;
  currentVersion: string | null;
  ratingAvg?: number;
  ratingCount?: number;
  sourceMeta?: Record<string, unknown>;
}

// Insert or refresh an external app, preserving curation flags + user data.
function upsertApp(input: UpsertInput): number {
  // Sanitize scraped/remote URLs before they ever reach the DB (defense in depth
  // against javascript:/data: URIs in href).
  input.website = safeHttpUrl(input.website);
  input.homepage = safeHttpUrl(input.homepage);

  const existing = getOne<AppRow>(
    qb
      .selectFrom("apps")
      .selectAll()
      .where("source", "=", input.source)
      .where(input.matchColumn, "=", input.matchValue)
  );

  if (existing) {
    db.prepare(
      `UPDATE apps SET name=@name, developer=@developer, tagline=@tagline,
         description=@description, category=@category, website=@website,
         homepage=@homepage, icon_key=COALESCE(@iconKey, icon_key),
         rating_avg=@ratingAvg, rating_count=@ratingCount, source_meta=@sourceMeta
       WHERE id=@id`
    ).run({
      id: existing.id,
      name: input.name,
      developer: input.developer,
      tagline: input.tagline,
      description: input.description,
      category: input.category,
      website: input.website,
      homepage: input.homepage,
      iconKey: input.iconKey,
      ratingAvg: input.ratingAvg ?? existing.rating_avg,
      ratingCount: input.ratingCount ?? existing.rating_count,
      sourceMeta: input.sourceMeta ? JSON.stringify(input.sourceMeta) : existing.source_meta,
    });
    return existing.id;
  }

  const slug = uniqueSlug(input.name);
  const info = db
    .prepare(
      `INSERT INTO apps
        (slug, name, developer, tagline, description, category, section, website,
         homepage, icon_key, source, ${input.matchColumn}, source_url,
         current_version, rating_avg, rating_count, source_meta)
       VALUES
        (@slug, @name, @developer, @tagline, @description, @category, 'apps', @website,
         @homepage, @iconKey, @source, @matchValue, @website,
         @currentVersion, @ratingAvg, @ratingCount, @sourceMeta)`
    )
    .run({
      slug,
      name: input.name,
      developer: input.developer,
      tagline: input.tagline,
      description: input.description,
      category: input.category,
      website: input.website,
      homepage: input.homepage,
      iconKey: input.iconKey,
      source: input.source,
      matchValue: input.matchValue,
      currentVersion: input.currentVersion,
      ratingAvg: input.ratingAvg ?? 0,
      ratingCount: input.ratingCount ?? 0,
      sourceMeta: input.sourceMeta ? JSON.stringify(input.sourceMeta) : null,
    });
  return Number(info.lastInsertRowid);
}

export async function ingestGithub(repoInput: string): Promise<number> {
  const { owner, repo } = github.parseRepo(repoInput);
  const repoMeta = await github.fetchRepoMeta(owner, repo);
  const release = await github.fetchLatestRelease(owner, repo);

  const slugBase = repoMeta.name || repo;
  let iconKey: string | null = null;
  if (repoMeta.avatarUrl) {
    iconKey = await downloadImage(
      repoMeta.avatarUrl,
      STORE_DIR,
      `${slugify(slugBase)}/assets`,
      "icon"
    );
  }

  const appId = upsertApp({
    source: "github",
    matchColumn: "source_repo",
    matchValue: `${owner}/${repo}`,
    name: repoMeta.name,
    developer: repoMeta.developer,
    tagline: repoMeta.description,
    description: repoMeta.description,
    category: "App",
    website: repoMeta.htmlUrl,
    homepage: repoMeta.homepage,
    iconKey,
    currentVersion: null,
    sourceMeta: { stars: repoMeta.stars },
  });

  if (release && release.tag) {
    const asset = github.pickApkAsset(release);
    if (asset) {
      db.prepare(
        `INSERT OR IGNORE INTO app_versions (app_id, version, apk_key, file_name, file_size, storage, download_url)
         VALUES (?, ?, '', ?, ?, 'download', ?)`
      ).run(appId, release.tag, asset.name, asset.size, asset.url);
      db.prepare(
        "UPDATE apps SET available_version = ?, update_available = 1 WHERE id = ?"
      ).run(release.tag, appId);
      const v = getOne<{ id: number }>(
        qb
          .selectFrom("app_versions")
          .select("id")
          .where("app_id", "=", appId)
          .where("version", "=", release.tag)
      );
      if (v) await downloadAndPromote(appId, v.id);
    }
  }
  return appId;
}

export async function ingestFdroid(packageInput: string): Promise<number> {
  const pkg = fdroid.normalizePackageId(packageInput);
  const m = await fdroid.fetchMeta(pkg);
  const top = m.versions.find((v) => v.versionCode === m.suggestedVersionCode) || m.versions[0];

  let iconKey: string | null = null;
  if (m.iconUrl) {
    iconKey = await downloadImage(m.iconUrl, STORE_DIR, `${slugify(m.name)}/assets`, "icon");
  }

  const appId = upsertApp({
    source: "fdroid",
    matchColumn: "source_package",
    matchValue: pkg,
    name: m.name,
    developer: null,
    tagline: m.summary,
    description: m.description || m.summary,
    category: "App",
    website: `https://f-droid.org/packages/${pkg}/`,
    homepage: null,
    iconKey,
    currentVersion: null,
    sourceMeta: top ? { availableVersionCode: top.versionCode } : {},
  });

  if (top) {
    db.prepare(
      `INSERT OR IGNORE INTO app_versions (app_id, version, apk_key, file_name, file_size, storage, download_url)
       VALUES (?, ?, '', ?, 0, 'download', ?)`
    ).run(appId, top.versionName, `${pkg}_${top.versionCode}.apk`, fdroid.apkUrl(pkg, top.versionCode));
    db.prepare(
      "UPDATE apps SET available_version = ?, update_available = 1 WHERE id = ?"
    ).run(top.versionName, appId);
    const v = getOne<{ id: number }>(
      qb
        .selectFrom("app_versions")
        .select("id")
        .where("app_id", "=", appId)
        .where("version", "=", top.versionName)
    );
    if (v) {
      await downloadAndPromote(appId, v.id);
      db.prepare(
        "UPDATE apps SET source_meta = ? WHERE id = ?"
      ).run(JSON.stringify({ versionCode: top.versionCode }), appId);
    }
  }
  return appId;
}

export async function ingestPlaystore(packageInput: string): Promise<number> {
  const pkg = playstore_normalize(packageInput);
  const m = await playstore.fetchAppMeta(pkg);

  const slugBase = m.name;
  let iconKey: string | null = null;
  if (m.iconUrl) {
    iconKey = await downloadImage(m.iconUrl, STORE_DIR, `${slugify(slugBase)}/assets`, "icon");
  }

  const appId = upsertApp({
    source: "playstore",
    matchColumn: "source_package",
    matchValue: pkg,
    name: m.name,
    developer: m.developer,
    tagline: m.summary,
    description: m.description,
    category: m.genre || "App",
    website: m.url,
    homepage: m.url,
    iconKey,
    currentVersion: m.version,
    ratingAvg: Math.round((m.score || 0) * 10) / 10,
    ratingCount: m.ratings || 0,
    sourceMeta: { playVersion: m.version },
  });

  // Screenshots (downloaded locally so the asset route can serve them).
  db.prepare("DELETE FROM app_screenshots WHERE app_id = ?").run(appId);
  let idx = 0;
  for (const url of m.screenshots) {
    const key = await downloadImage(url, STORE_DIR, `${slugify(slugBase)}/assets/screenshots`, `${idx}`);
    if (key) {
      db.prepare(
        "INSERT INTO app_screenshots (app_id, image_key, sort_order) VALUES (?, ?, ?)"
      ).run(appId, key, idx);
      idx++;
    }
  }
  return appId;
}

function playstore_normalize(input: string): string {
  const s = input.trim();
  const m = s.match(/[?&]id=([a-zA-Z0-9._]+)/);
  return m ? m[1] : s;
}

// Link a Play Store package to an EXISTING app (any primary source) for metadata
// enrichment + version-check. Does NOT change how the app's APK is served.
export async function linkPlay(
  appId: number,
  packageInput: string,
  opts: { refreshMeta?: boolean } = {}
): Promise<{ playName: string; version: string | null; updateAvailable: boolean; icon: boolean }> {
  const pkg = playstore_normalize(packageInput);
  const m = await playstore.fetchAppMeta(pkg); // validates the package exists

  const app = getOne<AppRow>(
    qb.selectFrom("apps").selectAll().where("id", "=", appId)
  );
  if (!app) throw new Error("App not found");

  db.prepare("UPDATE apps SET play_package = ? WHERE id = ?").run(pkg, appId);

  let icon = false;
  if (opts.refreshMeta) {
    // Fill gaps only — never overwrite the app's own curated metadata.
    if (!app.description && m.description) {
      db.prepare("UPDATE apps SET description = ? WHERE id = ?").run(m.description, appId);
    }
    if (!app.tagline && m.summary) {
      db.prepare("UPDATE apps SET tagline = ? WHERE id = ?").run(m.summary, appId);
    }
    // App icon — fill the gap when the app has none (e.g. a manually-added
    // archive folder with no logo.png). Stored with the "store:" prefix so it
    // resolves regardless of source (local apps otherwise serve from the
    // read-only archive). Curated icons are kept (fill-only).
    if (!app.icon_key && m.iconUrl) {
      const rel = await downloadImage(m.iconUrl, STORE_DIR, `${app.slug}/assets`, "play-icon");
      if (rel) {
        db.prepare("UPDATE apps SET icon_key = ? WHERE id = ?").run(storeKey(rel), appId);
        icon = true;
      }
    }
    // Import Play screenshots when the app has none. Downloaded into STORE_DIR
    // and keyed with the "store:" prefix so they resolve for ANY source —
    // including local archive apps (which serve from the read-only archive).
    const shotCount =
      getOne<{ c: number }>(
        qb
          .selectFrom("app_screenshots")
          .select((eb) => eb.fn.countAll<number>().as("c"))
          .where("app_id", "=", appId)
      )?.c ?? 0;
    if (shotCount === 0 && m.screenshots.length) {
      let idx = 0;
      for (const url of m.screenshots) {
        const rel = await downloadImage(
          url,
          STORE_DIR,
          `${app.slug}/assets/screenshots`,
          `${idx}`
        );
        if (rel) {
          db.prepare(
            "INSERT INTO app_screenshots (app_id, image_key, sort_order) VALUES (?, ?, ?)"
          ).run(appId, storeKey(rel), idx);
          idx++;
        }
      }
    }
  }

  const result = await checkPlayPackage(appId);
  return { playName: m.name, version: result.version, updateAvailable: result.updateAvailable, icon };
}

export function unlinkPlay(appId: number): void {
  db.prepare(
    "UPDATE apps SET play_package = NULL, update_available = 0, available_version = NULL WHERE id = ?"
  ).run(appId);
}

// Link a latestmodapks.com page to an existing app: fill metadata gaps, fetch a
// banner image into the writable store (resolves for any app via the "store:"
// key prefix), and run a version-check. Does not change APK serving.
export async function linkModApk(
  appId: number,
  input: string,
  opts: { refreshMeta?: boolean } = {}
): Promise<{
  name: string;
  version: string | null;
  updateAvailable: boolean;
  banner: boolean;
  icon: boolean;
}> {
  const meta = await fetchModSiteMeta(input);

  const app = getOne<AppRow>(
    qb.selectFrom("apps").selectAll().where("id", "=", appId)
  );
  if (!app) throw new Error("App not found");

  db.prepare("UPDATE apps SET modapk_url = ? WHERE id = ?").run(meta.url, appId);

  let banner = false;
  let icon = false;
  if (opts.refreshMeta) {
    if (!app.description && meta.description) {
      db.prepare("UPDATE apps SET description = ? WHERE id = ?").run(meta.description, appId);
    }
    if (!app.tagline && meta.tagline) {
      db.prepare("UPDATE apps SET tagline = ? WHERE id = ?").run(meta.tagline, appId);
    }
    // App logo/icon — when the site provides one (e.g. modapk.world's foreground
    // image), download it and replace the icon. Linking explicitly means "use
    // this app's logo", so overwrite.
    if (meta.iconUrl) {
      const ext = (meta.iconUrl.split("?")[0].match(/\.(png|jpe?g|webp)$/i)?.[1] || "png").toLowerCase();
      const rel = `${app.slug}/assets/modapk-icon.${ext}`;
      const size = await impersonateDownload(meta.iconUrl, path.join(STORE_DIR, rel));
      if (size > 0) {
        db.prepare("UPDATE apps SET icon_key = ? WHERE id = ?").run(storeKey(rel), appId);
        icon = true;
      }
    }
    // Banner image — download via curl-impersonate into STORE_DIR; store with the
    // "store:" prefix so it resolves regardless of the app's primary source.
    // Overwrite unless the app already has a non-store (archive) banner we should
    // keep — linking explicitly means "pull this app's banner".
    const keepExisting = app.banner_key && !app.banner_key.startsWith("store:");
    if (!keepExisting && meta.bannerUrl) {
      const ext = (meta.bannerUrl.split("?")[0].match(/\.(png|jpe?g|webp)$/i)?.[1] || "jpg").toLowerCase();
      const rel = `${app.slug}/assets/modapk-banner.${ext}`;
      const size = await impersonateDownload(
        meta.bannerUrl,
        path.join(STORE_DIR, rel)
      );
      if (size > 0) {
        db.prepare("UPDATE apps SET banner_key = ? WHERE id = ?").run(storeKey(rel), appId);
        banner = true;
      }
    }
  }

  const result = await checkModApk(appId);
  return {
    name: meta.name,
    version: result.version,
    updateAvailable: result.updateAvailable,
    banner,
    icon,
  };
}

export function unlinkModApk(appId: number): void {
  db.prepare(
    "UPDATE apps SET modapk_url = NULL, update_available = 0, available_version = NULL WHERE id = ?"
  ).run(appId);
}

// Link an F-Droid package to an existing app: fill metadata gaps (summary →
// tagline/description), fetch the app icon into the writable store (resolves for
// any source via the "store:" prefix), and run a version-check. Does not change
// APK serving — F-Droid here is metadata + version-check only.
export async function linkFdroid(
  appId: number,
  packageInput: string,
  opts: { refreshMeta?: boolean } = {}
): Promise<{ name: string; version: string | null; updateAvailable: boolean; icon: boolean }> {
  const pkg = fdroid.normalizePackageId(packageInput);
  const m = await fdroid.fetchMeta(pkg); // validates + gets versions/icon/summary
  if (!m.versions.length) throw new Error(`No F-Droid package found for "${pkg}"`);

  const app = getOne<AppRow>(
    qb.selectFrom("apps").selectAll().where("id", "=", appId)
  );
  if (!app) throw new Error("App not found");

  db.prepare("UPDATE apps SET fdroid_package = ? WHERE id = ?").run(pkg, appId);

  let icon = false;
  if (opts.refreshMeta) {
    // Fill gaps only — never overwrite the app's own curated metadata. The full
    // page description is preferred; the short summary is the fallback/tagline.
    const fullDesc = m.description || m.summary;
    if (!app.description && fullDesc) {
      db.prepare("UPDATE apps SET description = ? WHERE id = ?").run(fullDesc, appId);
    }
    if (!app.tagline && m.summary) {
      db.prepare("UPDATE apps SET tagline = ? WHERE id = ?").run(m.summary, appId);
    }
    if (!app.icon_key && m.iconUrl) {
      const rel = await downloadImage(m.iconUrl, STORE_DIR, `${app.slug}/assets`, "fdroid-icon");
      if (rel) {
        db.prepare("UPDATE apps SET icon_key = ? WHERE id = ?").run(storeKey(rel), appId);
        icon = true;
      }
    }
  }

  const result = await checkFdroidPackage(appId);
  return {
    name: m.name || pkg,
    version: result.version,
    updateAvailable: result.updateAvailable,
    icon,
  };
}

export function unlinkFdroid(appId: number): void {
  db.prepare(
    "UPDATE apps SET fdroid_package = NULL, update_available = 0, available_version = NULL WHERE id = ?"
  ).run(appId);
}
