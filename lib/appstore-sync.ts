import type Database from "better-sqlite3";
import { scanArchive } from "./appstore-archive";

// Sync the on-disk archive into the apps/app_versions/app_screenshots tables.
// Idempotent: upserts catalog metadata by slug but never clobbers admin-curated
// flags (featured/editors_choice/enabled/sort_order) or user data
// (installs/reviews/saves). Returns how many apps were seen.
export function syncArchiveCatalog(db: Database.Database): {
  scanned: number;
  inserted: number;
  updated: number;
} {
  const apps = scanArchive();
  let inserted = 0;
  let updated = 0;

  const findBySlug = db.prepare("SELECT id FROM apps WHERE slug = ?");
  const insertApp = db.prepare(`
    INSERT INTO apps
      (slug, name, developer, tagline, description, category, section, website,
       icon_key, banner_key, source, requires_pin, current_version)
    VALUES
      (@slug, @name, @developer, @tagline, @description, @category, @section, @website,
       @icon_key, @banner_key, 'local', @requires_pin, @current_version)
  `);
  // Refresh only mutable metadata pulled from the archive; leave curation + stats
  // alone. Preserve externally-downloaded assets (keys prefixed "store:", e.g. a
  // banner pulled from a Play/latestmodapks link) so a rescan never wipes them.
  const updateApp = db.prepare(`
    UPDATE apps SET
      name = @name, developer = @developer, tagline = @tagline,
      description = @description, category = @category, section = @section,
      website = @website,
      icon_key = CASE WHEN icon_key LIKE 'store:%' THEN icon_key ELSE @icon_key END,
      banner_key = CASE WHEN banner_key LIKE 'store:%' THEN banner_key ELSE @banner_key END,
      requires_pin = @requires_pin, current_version = @current_version
    WHERE id = @id
  `);

  // Rebuild ONLY the archive-sourced rows; never delete link-installed assets
  // (apk_key/image_key prefixed "store:", e.g. an APK installed from APKPure or
  // screenshots pulled from a Play/APKPure link) or the rescan would wipe them.
  const delVersions = db.prepare(
    "DELETE FROM app_versions WHERE app_id = ? AND (apk_key NOT LIKE 'store:%' OR apk_key IS NULL)"
  );
  const insVersion = db.prepare(`
    INSERT OR IGNORE INTO app_versions
      (app_id, version, apk_key, file_name, file_size, is_current)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const linkedVersions = db.prepare(
    "SELECT id, version FROM app_versions WHERE app_id = ? AND apk_key LIKE 'store:%' ORDER BY id DESC"
  );
  const clearCurrent = db.prepare("UPDATE app_versions SET is_current = 0 WHERE app_id = ?");
  const setCurrentById = db.prepare("UPDATE app_versions SET is_current = 1 WHERE id = ?");
  const setAppCurrentVersion = db.prepare("UPDATE apps SET current_version = ? WHERE id = ?");
  const delShots = db.prepare(
    "DELETE FROM app_screenshots WHERE app_id = ? AND (image_key NOT LIKE 'store:%' OR image_key IS NULL)"
  );
  const insShot = db.prepare(
    "INSERT INTO app_screenshots (app_id, image_key, sort_order) VALUES (?, ?, ?)"
  );

  const run = db.transaction(() => {
    for (const app of apps) {
      const currentVersion = app.versions[0]?.version ?? null;
      const existing = findBySlug.get(app.slug) as { id: number } | undefined;
      const fields = {
        slug: app.slug,
        name: app.name,
        developer: app.developer,
        tagline: app.tagline,
        description: app.description,
        category: app.category,
        section: app.section,
        website: app.website,
        icon_key: app.iconKey,
        banner_key: app.bannerKey,
        requires_pin: app.isAdult ? 1 : 0,
        current_version: currentVersion,
      };

      let appId: number;
      if (existing) {
        appId = existing.id;
        updateApp.run({ ...fields, id: appId });
        updated++;
      } else {
        const info = insertApp.run(fields);
        appId = Number(info.lastInsertRowid);
        inserted++;
      }

      // Rebuild the ARCHIVE versions (source of truth) but keep link-installed
      // (store:) ones. A link-installed version (e.g. an APKPure install) stays
      // current; otherwise the archive's newest is current.
      const linked = linkedVersions.all(appId) as { id: number; version: string }[];
      delVersions.run(appId);
      app.versions.forEach((v, idx) => {
        insVersion.run(
          appId,
          v.version,
          v.apkKey,
          v.fileName,
          v.fileSize,
          !linked.length && idx === 0 ? 1 : 0
        );
      });
      if (linked.length) {
        clearCurrent.run(appId);
        setCurrentById.run(linked[0].id);
        setAppCurrentVersion.run(linked[0].version, appId);
      }

      // Rebuild archive screenshots; keep link-pulled (store:) ones.
      delShots.run(appId);
      app.screenshots.forEach((key, idx) => insShot.run(appId, key, idx));
    }
  });
  run();

  return { scanned: apps.length, inserted, updated };
}
