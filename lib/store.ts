import fs from "node:fs";
import path from "node:path";
import { sql } from "kysely";
import { db, AppRow, AppVersionRow, AppScreenshotRow } from "./db";
import { qb, getOne, getAll } from "./kysely";
import { STORE_DIR } from "./appstore-storage";

// Serializable shape passed to client components (no raw file paths leak out;
// images are addressed through the auth-gated asset route).
export interface AppCard {
  id: number;
  slug: string;
  name: string;
  developer: string | null;
  category: string;
  section: "apps" | "games";
  tagline: string | null;
  iconUrl: string;
  bannerUrl: string | null;
  requiresPin: boolean;
  featured: boolean;
  editorsChoice: boolean;
  ratingAvg: number;
  ratingCount: number;
  installCount: number;
  currentVersion: string | null;
  installed: boolean;
  saved: boolean;
  source: string;
  website: string | null;
  updateAvailable: boolean;
  availableVersion: string | null;
  playUrl: string | null;
}

export interface AppVersionInfo {
  id: number;
  version: string;
  fileName: string | null;
  fileSize: number;
  isCurrent: boolean;
}

export interface AppReview {
  id: number;
  userId: number;
  author: string;
  rating: number;
  body: string | null;
  createdAt: string;
}

export interface AppDetail extends AppCard {
  description: string | null;
  website: string | null;
  screenshots: string[]; // asset URLs
  versions: AppVersionInfo[];
  reviews: AppReview[];
  myReview: { rating: number; body: string | null } | null;
}

export interface Shelf {
  key: string;
  title: string;
  apps: AppCard[];
}

function iconUrl(id: number): string {
  return `/api/store/${id}/asset?type=icon`;
}
function bannerUrl(id: number, hasBanner: boolean): string | null {
  return hasBanner ? `/api/store/${id}/asset?type=banner` : null;
}

function toCard(
  row: AppRow,
  installed: Set<number>,
  saved: Set<number>
): AppCard {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    developer: row.developer,
    category: row.category,
    section: row.section,
    tagline: row.tagline,
    iconUrl: iconUrl(row.id),
    bannerUrl: bannerUrl(row.id, !!row.banner_key),
    requiresPin: !!row.requires_pin,
    featured: !!row.featured,
    editorsChoice: !!row.editors_choice,
    ratingAvg: row.rating_avg,
    ratingCount: row.rating_count,
    installCount: row.install_count,
    currentVersion: row.current_version,
    installed: installed.has(row.id),
    saved: saved.has(row.id),
    source: row.source,
    website: row.website,
    updateAvailable: !!row.update_available,
    availableVersion: row.available_version,
    playUrl: row.play_package
      ? `https://play.google.com/store/apps/details?id=${row.play_package}`
      : row.source === "playstore" && row.source_package
        ? `https://play.google.com/store/apps/details?id=${row.source_package}`
        : null,
  };
}

function installedSet(userId: number): Set<number> {
  const rows = getAll<{ app_id: number }>(
    qb.selectFrom("user_app_installs").select("app_id").where("user_id", "=", userId)
  );
  return new Set(rows.map((r) => r.app_id));
}
function savedSet(userId: number): Set<number> {
  const rows = getAll<{ app_id: number }>(
    qb.selectFrom("saved_apps").select("app_id").where("user_id", "=", userId)
  );
  return new Set(rows.map((r) => r.app_id));
}

// Whether a viewer may see/install an app. Adult apps require an unlocked 18+
// gate (the caller resolves that via has18Access and passes it in).
export function canAccessApp(app: AppRow, adultUnlocked: boolean): boolean {
  if (!app.enabled) return false;
  if (app.requires_pin && !adultUnlocked) return false;
  return true;
}

function allVisibleApps(adultUnlocked: boolean): AppRow[] {
  const rows = getAll<AppRow>(
    qb
      .selectFrom("apps")
      .selectAll()
      .where("enabled", "=", 1)
      .orderBy("sort_order")
      .orderBy("name")
  );
  return adultUnlocked ? rows : rows.filter((r) => !r.requires_pin);
}

// Build the Discover page: a hero list + a series of shelves. Shelves with no
// members are omitted so the page never shows an empty row.
export function getDiscover(
  userId: number,
  adultUnlocked: boolean
): { hero: AppCard[]; shelves: Shelf[] } {
  const apps = allVisibleApps(adultUnlocked);
  const installed = installedSet(userId);
  const saved = savedSet(userId);
  const cards = apps.map((a) => toCard(a, installed, saved));
  const byId = new Map(cards.map((c) => [c.id, c] as [number, AppCard]));

  const hero = apps
    .filter((a) => a.banner_key && (a.featured || true))
    .sort((a, b) => b.featured - a.featured)
    .slice(0, 6)
    .map((a) => byId.get(a.id)!)
    .filter(Boolean);

  const shelves: Shelf[] = [];
  const pushShelf = (key: string, title: string, list: AppCard[]) => {
    if (list.length) shelves.push({ key, title, apps: list });
  };

  pushShelf(
    "editors",
    "Editor's Choice",
    cards.filter((c) => c.editorsChoice).slice(0, 12)
  );
  pushShelf(
    "featured",
    "Featured",
    cards.filter((c) => c.featured).slice(0, 12)
  );
  pushShelf(
    "popular",
    "Popular",
    [...cards]
      .filter((c) => c.section === "apps")
      .sort((a, b) => b.installCount - a.installCount || b.ratingAvg - a.ratingAvg)
      .slice(0, 12)
  );
  pushShelf(
    "top-rated",
    "Top Rated",
    [...cards]
      .filter((c) => c.ratingCount > 0)
      .sort((a, b) => b.ratingAvg - a.ratingAvg)
      .slice(0, 12)
  );

  // One shelf per category (apps section), largest categories first.
  const cats = new Map<string, AppCard[]>();
  for (const c of cards) {
    if (c.section !== "apps") continue;
    if (!cats.has(c.category)) cats.set(c.category, []);
    cats.get(c.category)!.push(c);
  }
  Array.from(cats.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([cat, list]) => {
      if (list.length >= 3)
        pushShelf(`cat-${cat}`, cat, list.slice(0, 12));
    });

  pushShelf(
    "games",
    "Games",
    cards.filter((c) => c.section === "games").slice(0, 12)
  );

  return { hero, shelves };
}

export function searchApps(
  userId: number,
  adultUnlocked: boolean,
  opts: { q?: string; category?: string; section?: string; sort?: string }
): AppCard[] {
  let q = qb.selectFrom("apps").selectAll().where("enabled", "=", 1);
  if (!adultUnlocked) q = q.where("requires_pin", "=", 0);
  if (opts.q && opts.q.trim()) {
    const like = `%${opts.q.trim()}%`;
    q = q.where((eb) =>
      eb.or([
        eb("name", "like", like),
        eb("developer", "like", like),
        eb("tagline", "like", like),
        eb("description", "like", like),
        eb("category", "like", like),
      ])
    );
  }
  if (opts.category) q = q.where("category", "=", opts.category);
  if (opts.section) q = q.where("section", "=", opts.section as "apps" | "games");

  switch (opts.sort) {
    case "rating":
      q = q.orderBy("rating_avg", "desc").orderBy("rating_count", "desc");
      break;
    case "popular":
      q = q.orderBy("install_count", "desc").orderBy("rating_avg", "desc");
      break;
    case "newest":
      q = q.orderBy("created_at", "desc").orderBy("id", "desc");
      break;
    default:
      q = q.orderBy(sql`name collate nocase`);
  }

  const rows = getAll<AppRow>(q.limit(200));
  const installed = installedSet(userId);
  const saved = savedSet(userId);
  return rows.map((r) => toCard(r, installed, saved));
}

export function listCategories(adultUnlocked: boolean): string[] {
  const rows = getAll<{ category: string }>(
    qb
      .selectFrom("apps")
      .select("category")
      .distinct()
      .where("enabled", "=", 1)
      .$if(!adultUnlocked, (q) => q.where("requires_pin", "=", 0))
      .orderBy("category")
  );
  return rows.map((r) => r.category);
}

export function getAppRow(idOrSlug: string | number): AppRow | undefined {
  if (typeof idOrSlug === "number" || /^\d+$/.test(String(idOrSlug))) {
    return getOne<AppRow>(
      qb.selectFrom("apps").selectAll().where("id", "=", Number(idOrSlug))
    );
  }
  return getOne<AppRow>(
    qb.selectFrom("apps").selectAll().where("slug", "=", String(idOrSlug))
  );
}

export function getAppDetail(
  idOrSlug: string | number,
  userId: number,
  adultUnlocked: boolean
): AppDetail | null {
  const row = getAppRow(idOrSlug);
  if (!row || !canAccessApp(row, adultUnlocked)) return null;

  const installed = installedSet(userId);
  const saved = savedSet(userId);
  const base = toCard(row, installed, saved);

  const shots = getAll<AppScreenshotRow>(
    qb
      .selectFrom("app_screenshots")
      .selectAll()
      .where("app_id", "=", row.id)
      .orderBy("sort_order")
  );
  const versions = getAll<AppVersionRow>(
    qb
      .selectFrom("app_versions")
      .selectAll()
      .where("app_id", "=", row.id)
      .orderBy("is_current", "desc")
      .orderBy("version")
  );

  const reviews = getAll<{
    id: number;
    user_id: number;
    rating: number;
    body: string | null;
    created_at: string;
    author: string;
  }>(
    qb
      .selectFrom("app_reviews as r")
      .leftJoin("user_profiles as p", "p.user_id", "r.user_id")
      .select([
        "r.id",
        "r.user_id",
        "r.rating",
        "r.body",
        "r.created_at",
        sql<string>`COALESCE(p.username, 'user')`.as("author"),
      ])
      .where("r.app_id", "=", row.id)
      .orderBy("r.created_at", "desc")
      .limit(50)
  );

  const mine = getOne<{ rating: number; body: string | null }>(
    qb
      .selectFrom("app_reviews")
      .select(["rating", "body"])
      .where("app_id", "=", row.id)
      .where("user_id", "=", userId)
  );

  return {
    ...base,
    description: row.description,
    website: row.website,
    screenshots: shots.map(
      (_s, i) => `/api/store/${row.id}/asset?type=screenshot&i=${i}`
    ),
    versions: versions.map((v) => ({
      id: v.id,
      version: v.version,
      fileName: v.file_name,
      fileSize: v.file_size,
      isCurrent: !!v.is_current,
    })),
    reviews: reviews.map((r) => ({
      id: r.id,
      userId: r.user_id,
      author: r.author,
      rating: r.rating,
      body: r.body,
      createdAt: r.created_at,
    })),
    myReview: mine ? { rating: mine.rating, body: mine.body } : null,
  };
}

// --- Mutations ---

export function installApp(userId: number, appId: number): void {
  // The install row and the counter commit together so a crash between them
  // can never leave the counter drifting from the actual installs.
  db.transaction(() => {
    const info = db
      .prepare(
        `INSERT OR IGNORE INTO user_app_installs (user_id, app_id) VALUES (?, ?)`
      )
      .run(userId, appId);
    if (info.changes > 0) {
      db.prepare(
        "UPDATE apps SET install_count = install_count + 1 WHERE id = ?"
      ).run(appId);
    }
  })();
}

export function uninstallApp(userId: number, appId: number): void {
  db.transaction(() => {
    const info = db
      .prepare("DELETE FROM user_app_installs WHERE user_id = ? AND app_id = ?")
      .run(userId, appId);
    if (info.changes > 0) {
      db.prepare(
        "UPDATE apps SET install_count = MAX(0, install_count - 1) WHERE id = ?"
      ).run(appId);
    }
  })();
}

export function setSaved(userId: number, appId: number, saved: boolean): void {
  if (saved) {
    db.prepare(
      "INSERT OR IGNORE INTO saved_apps (user_id, app_id) VALUES (?, ?)"
    ).run(userId, appId);
  } else {
    db.prepare("DELETE FROM saved_apps WHERE user_id = ? AND app_id = ?").run(
      userId,
      appId
    );
  }
}

export function markOpened(userId: number, appId: number): void {
  db.prepare(
    "UPDATE user_app_installs SET last_opened_at = datetime('now') WHERE user_id = ? AND app_id = ?"
  ).run(userId, appId);
}

export function listInstalled(userId: number): AppCard[] {
  const rows = getAll<AppRow>(
    qb
      .selectFrom("apps as a")
      .innerJoin("user_app_installs as i", "i.app_id", "a.id")
      .selectAll("a")
      .where("i.user_id", "=", userId)
      .where("a.enabled", "=", 1)
      .orderBy(sql`coalesce(i.last_opened_at, i.installed_at) desc`)
  );
  const installed = installedSet(userId);
  const saved = savedSet(userId);
  return rows.map((r) => toCard(r, installed, saved));
}

export function listSaved(userId: number): AppCard[] {
  const rows = getAll<AppRow>(
    qb
      .selectFrom("apps as a")
      .innerJoin("saved_apps as s", "s.app_id", "a.id")
      .selectAll("a")
      .where("s.user_id", "=", userId)
      .where("a.enabled", "=", 1)
      .orderBy("s.saved_at", "desc")
  );
  const installed = installedSet(userId);
  const saved = savedSet(userId);
  return rows.map((r) => toCard(r, installed, saved));
}

function recomputeRating(appId: number): void {
  const agg = getOne<{ n: number; avg: number }>(
    qb
      .selectFrom("app_reviews")
      .select((eb) => [
        eb.fn.countAll<number>().as("n"),
        sql<number>`COALESCE(AVG(rating), 0)`.as("avg"),
      ])
      .where("app_id", "=", appId)
  )!;
  db.prepare("UPDATE apps SET rating_avg = ?, rating_count = ? WHERE id = ?").run(
    Math.round(agg.avg * 100) / 100,
    agg.n,
    appId
  );
}

export function upsertReview(
  userId: number,
  appId: number,
  rating: number,
  body: string | null
): void {
  const r = Math.max(1, Math.min(5, Math.round(rating)));
  db.prepare(
    `INSERT INTO app_reviews (app_id, user_id, rating, body)
       VALUES (?, ?, ?, ?)
     ON CONFLICT(app_id, user_id)
       DO UPDATE SET rating = excluded.rating, body = excluded.body,
                     updated_at = datetime('now')`
  ).run(appId, userId, r, body);
  recomputeRating(appId);
}

export function deleteReview(userId: number, appId: number): void {
  db.prepare("DELETE FROM app_reviews WHERE app_id = ? AND user_id = ?").run(
    appId,
    userId
  );
  recomputeRating(appId);
}

// Pick the APK to serve for an app: a specific version id, else the current one.
export function getDownloadVersion(
  appId: number,
  versionId?: number
): AppVersionRow | undefined {
  if (versionId) {
    return getOne<AppVersionRow>(
      qb
        .selectFrom("app_versions")
        .selectAll()
        .where("id", "=", versionId)
        .where("app_id", "=", appId)
    );
  }
  return getOne<AppVersionRow>(
    qb
      .selectFrom("app_versions")
      .selectAll()
      .where("app_id", "=", appId)
      .orderBy("is_current", "desc")
      .orderBy("id")
      .limit(1)
  );
}

export function getScreenshotKey(appId: number, index: number): string | null {
  const row = getOne<{ image_key: string }>(
    qb
      .selectFrom("app_screenshots")
      .select("image_key")
      .where("app_id", "=", appId)
      .orderBy("sort_order")
      .limit(1)
      .offset(index)
  );
  return row?.image_key ?? null;
}

// --- Admin ---

export function adminListApps(): AppRow[] {
  return getAll<AppRow>(
    qb
      .selectFrom("apps")
      .selectAll()
      .orderBy("section")
      .orderBy("category")
      .orderBy("name")
  );
}

export function adminSetFlag(
  appId: number,
  flag: "featured" | "editors_choice" | "enabled",
  value: boolean
): void {
  db.prepare(`UPDATE apps SET ${flag} = ? WHERE id = ?`).run(value ? 1 : 0, appId);
}

// Delete an app and its downloaded assets. NOTE: a local archive app reappears
// on the next "Rescan archive" (the archive folder is the source of truth) —
// hide it with the Enabled toggle instead if that's not wanted.
export function adminDeleteApp(appId: number): void {
  const row = getAppRow(appId);
  db.prepare("DELETE FROM apps WHERE id = ?").run(appId);
  if (row) {
    try {
      fs.rmSync(path.join(STORE_DIR, row.slug), { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

// Set a custom uploaded icon (stored in STORE_DIR, resolves via the store: prefix).
export function adminSetIconKey(appId: number, storeRelKey: string): void {
  db.prepare("UPDATE apps SET icon_key = ? WHERE id = ?").run(storeRelKey, appId);
}
