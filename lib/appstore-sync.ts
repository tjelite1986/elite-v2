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

  const delVersions = db.prepare("DELETE FROM app_versions WHERE app_id = ?");
  const insVersion = db.prepare(`
    INSERT OR IGNORE INTO app_versions
      (app_id, version, apk_key, file_name, file_size, is_current)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const delShots = db.prepare("DELETE FROM app_screenshots WHERE app_id = ?");
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

      // Rebuild versions + screenshots from the archive (source of truth).
      delVersions.run(appId);
      app.versions.forEach((v, idx) => {
        insVersion.run(
          appId,
          v.version,
          v.apkKey,
          v.fileName,
          v.fileSize,
          idx === 0 ? 1 : 0
        );
      });

      delShots.run(appId);
      app.screenshots.forEach((key, idx) => insShot.run(appId, key, idx));
    }
  });
  run();

  return { scanned: apps.length, inserted, updated };
}
