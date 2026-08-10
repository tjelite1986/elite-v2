import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { db } from "./db";
import type { VideoPerformerRow, VideoRow } from "./db";
import { posterFilePath, videoFilePath } from "./videos-storage";
import { tpdbConfigured } from "./tpdb";
import { safeHttpUrl } from "./safe-url";
import { assertPublicUrl } from "./link-preview";

// Performer profiles for the 18+ video library. Deliberately its own table
// rather than users or post_creators: these are people a film credits, with no
// account, no login and nothing of their own beyond the videos they appear in.
//
// A profile is assembled from two sources, cheapest first: the artwork and
// credits that shipped in the release folder, then ThePornDB for the biography
// and a proper portrait.

export interface PerformerWithCount extends VideoPerformerRow {
  video_count: number;
}

export interface PerformerDetail extends PerformerWithCount {
  images: number[]; // gallery indices, in order
}

const GALLERY_LIMIT = 8;

export function performerSlug(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "unknown"
  );
}

// Link a video to its performers, creating any profile that is new. Replaces
// the set this metadata owns, so removing a name from the metadata removes the
// link too — but hand-made links and hand-made profiles are left alone: they
// were never derived from a sidecar or the API, so a rematch cannot know them.
export function setVideoPerformers(videoId: number, names: string[]): void {
  const insertPerformer = db.prepare(
    "INSERT OR IGNORE INTO video_performers (slug, name) VALUES (?, ?)"
  );
  const link = db.prepare(
    "INSERT OR IGNORE INTO video_performer_links (video_id, performer_slug) VALUES (?, ?)"
  );
  const slugs: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const slug = performerSlug(name);
    insertPerformer.run(slug, name);
    link.run(videoId, slug);
    slugs.push(slug);
  }
  // Drop the automatic links this video no longer claims.
  const placeholders = slugs.map(() => "?").join(", ");
  db.prepare(
    `DELETE FROM video_performer_links
      WHERE video_id = ? AND manual = 0${
        slugs.length ? ` AND performer_slug NOT IN (${placeholders})` : ""
      }`
  ).run(videoId, ...slugs);
  pruneOrphanPerformers();
}

// A derived profile nobody links to any more is noise. A hand-made one is not:
// it exists because someone created it, even with no film attached yet.
export function pruneOrphanPerformers(): void {
  const orphans = db
    .prepare(
      `SELECT slug FROM video_performers
        WHERE manual = 0
          AND slug NOT IN (SELECT performer_slug FROM video_performer_links)`
    )
    .all() as { slug: string }[];
  for (const { slug } of orphans) deletePerformer(slug);
}

// The portrait that shipped with a release: "<release>-Performer-Dee-Williams-image.png".
function findLocalPortrait(row: VideoRow, name: string): string | null {
  const dir = path.dirname(videoFilePath(row.channel, row.storage_key));
  const wanted = performerSlug(name);
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const m = /-Performer-(.+?)-image\.[a-z0-9]+$/i.exec(entry);
    if (m && performerSlug(m[1].replace(/-/g, " ")) === wanted) {
      return path.join(dir, entry);
    }
  }
  return null;
}

async function storePortrait(
  slug: string,
  source: { file?: string; buffer?: Buffer }
): Promise<string | null> {
  const name = `performer_${slug}.jpg`;
  try {
    const input = source.file ?? source.buffer;
    if (!input) return null;
    await sharp(input as string | Buffer)
      .resize({ width: 500, height: 500, fit: "cover", position: "top" })
      .jpeg({ quality: 85 })
      .toFile(posterFilePath(name));
    return name;
  } catch {
    return null;
  }
}

// Import portraits from the release folder for every performer this video
// credits. Cheap, offline, and often the only picture available.
export async function importLocalPortraits(
  row: VideoRow,
  names: string[]
): Promise<void> {
  for (const name of names) {
    const slug = performerSlug(name);
    const existing = db
      .prepare("SELECT image_key FROM video_performers WHERE slug = ?")
      .get(slug) as { image_key: string | null } | undefined;
    if (existing?.image_key) continue;
    const file = findLocalPortrait(row, name);
    if (!file) continue;
    const key = await storePortrait(slug, { file });
    if (key) {
      db.prepare("UPDATE video_performers SET image_key = ? WHERE slug = ?").run(
        key,
        slug
      );
    }
  }
}

// Rebuild links for videos whose metadata already lists performers but that
// have none linked. Anything matched before this feature existed kept its
// meta_performers and never got a profile — and since those rows are already
// 'auto', the matcher skips them forever. Cheap enough to run every pass.
export async function backfillPerformerLinks(): Promise<number> {
  const rows = db
    .prepare(
      `SELECT v.* FROM videos v
        WHERE v.channel = 'adults'
          AND v.meta_performers IS NOT NULL
          AND v.meta_performers <> '[]'
          AND NOT EXISTS (
            SELECT 1 FROM video_performer_links l WHERE l.video_id = v.id
          )`
    )
    .all() as VideoRow[];

  let linked = 0;
  for (const row of rows) {
    let names: string[] = [];
    try {
      const parsed = JSON.parse(row.meta_performers || "[]");
      if (Array.isArray(parsed)) {
        names = parsed.filter((n): n is string => typeof n === "string");
      }
    } catch {
      continue;
    }
    if (!names.length) continue;
    setVideoPerformers(row.id, names);
    await importLocalPortraits(row, names);
    linked++;
  }
  return linked;
}

// --- ThePornDB enrichment ---------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function tpdbPerformer(name: string): Promise<any | null> {
  const key = process.env.TPDB_API_KEY;
  if (!key) return null;
  const url = new URL("https://api.theporndb.net/performers");
  url.searchParams.set("q", name);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    // Only an exact name match counts: "Dee" must not become "Dee Williams".
    const wanted = performerSlug(name);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exact = (data?.data || []).filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (p: any) => performerSlug(p.name || "") === wanted
    );
    // Several records share a popular stage name; the one with a portrait and a
    // biography is the maintained entry.
    return (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exact.find((p: any) => p.image && p.bio) ??
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      exact.find((p: any) => p.image) ??
      exact[0] ??
      null
    );
  } catch {
    return null;
  }
}

// One performer addressed by its identifier — the way out when the stage name
// is ambiguous, misspelled in the release, or shared by several records.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function tpdbPerformerById(id: string): Promise<any | null> {
  const key = process.env.TPDB_API_KEY;
  if (!key) return null;
  const url = new URL(
    `https://api.theporndb.net/performers/${encodeURIComponent(id)}`
  );
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.data ?? null;
  } catch {
    return null;
  }
}

// Fetch a profile from ThePornDB. `tpdbId` addresses one exact record;
// otherwise the id already stored on the row wins over another name search,
// and only then does it fall back to searching for the name.
export async function enrichPerformer(
  slug: string,
  tpdbId?: string
): Promise<boolean> {
  const row = db
    .prepare("SELECT * FROM video_performers WHERE slug = ?")
    .get(slug) as VideoPerformerRow | undefined;
  if (!row) return false;

  const id = tpdbId?.trim() || row.tpdb_id;
  const found = id
    ? ((await tpdbPerformerById(id)) ?? (tpdbId ? null : await tpdbPerformer(row.name)))
    : await tpdbPerformer(row.name);
  // Record the attempt either way, so a performer the database has never heard
  // of is not looked up again on every run.
  if (!found) {
    db.prepare(
      "UPDATE video_performers SET checked_at = datetime('now') WHERE slug = ?"
    ).run(slug);
    return false;
  }

  const extras = found.extras || {};
  let imageKey = row.image_key;
  if (!imageKey && found.image) {
    try {
      await assertPublicUrl(new URL(found.image));
      const res = await fetch(found.image, { signal: AbortSignal.timeout(30_000) });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length) imageKey = await storePortrait(slug, { buffer: buf });
      }
    } catch {
      /* portrait is best-effort */
    }
  }

  // extras.links arrives as an OBJECT map ({ IAFD: url, IMDb: url }), not the
  // array its siblings use — checking for an array silently threw every link
  // away. Accept both shapes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const normalizeLinks = (raw: any): { key: string; value: string }[] => {
    const pairs: { key: string; value: unknown }[] = Array.isArray(raw)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? raw.map((l: any) => ({ key: String(l?.key ?? "Link"), value: l?.value }))
      : raw && typeof raw === "object"
        ? Object.entries(raw).map(([key, value]) => ({ key, value }))
        : [];
    return pairs
      .map(({ key, value }) => ({ key, value: safeHttpUrl(value) }))
      .filter((l): l is { key: string; value: string } => l.value !== null);
  };

  const num = (v: unknown): number | null =>
    Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : null;
  const bool = (v: unknown): number | null =>
    typeof v === "boolean" ? (v ? 1 : 0) : null;

  // On a hand-made profile the fetch fills gaps instead of flattening them: a
  // field the database has nothing to say about keeps what was typed in.
  const assignments: [column: string, param: string][] = [
    ["tpdb_id", "tpdbId"],
    ["bio", "bio"],
    ["birthday", "birthday"],
    ["birthplace", "birthplace"],
    ["nationality", "nationality"],
    ["height", "height"],
    ["measurements", "measurements"],
    ["hair_colour", "hair"],
    ["eye_colour", "eye"],
    ["career_start", "careerStart"],
    ["career_end", "careerEnd"],
    ["gender", "gender"],
    ["ethnicity", "ethnicity"],
    ["cupsize", "cupsize"],
    ["weight", "weight"],
    ["waist", "waist"],
    ["hips", "hips"],
    ["tattoos", "tattoos"],
    ["piercings", "piercings"],
    ["fake_boobs", "fakeBoobs"],
    ["same_sex_only", "sameSexOnly"],
    ["astrology", "astrology"],
    ["deathday", "deathday"],
    ["full_name", "fullName"],
    ["disambiguation", "disambiguation"],
    ["rating", "rating"],
    ["aliases", "aliases"],
    ["links", "links"],
    ["image_key", "image"],
  ];
  const setClause = assignments
    .map(([column, param]) =>
      row.manual
        ? `${column} = COALESCE(@${param}, ${column})`
        : `${column} = @${param}`
    )
    .join(", ");

  db.prepare(
    `UPDATE video_performers SET ${setClause}, checked_at = datetime('now')
     WHERE slug = @slug`
  ).run({
    slug,
    tpdbId: found.id ? String(found.id) : null,
    bio: found.bio || null,
    birthday: extras.birthday || null,
    birthplace: extras.birthplace || null,
    nationality: extras.nationality || null,
    height: extras.height || null,
    measurements: extras.measurements || null,
    hair: extras.hair_colour || null,
    eye: extras.eye_colour || null,
    careerStart: num(extras.career_start_year),
    careerEnd: num(extras.career_end_year),
    gender: extras.gender || null,
    ethnicity: extras.ethnicity || null,
    cupsize: extras.cupsize || null,
    weight: extras.weight || null,
    waist: extras.waist || null,
    hips: extras.hips || null,
    tattoos: extras.tattoos || null,
    piercings: extras.piercings || null,
    fakeBoobs: bool(extras.fake_boobs),
    sameSexOnly: bool(extras.same_sex_only),
    astrology: extras.astrology || null,
    deathday: extras.deathday || null,
    fullName: found.full_name || null,
    disambiguation: found.disambiguation || null,
    rating: num(found.rating),
    aliases: Array.isArray(found.aliases) ? JSON.stringify(found.aliases) : null,
    links: (() => {
      const list = normalizeLinks(extras.links);
      return list.length ? JSON.stringify(list) : null;
    })(),
    image: imageKey,
  });

  await importGallery(slug, found.posters);
  return true;
}

// The photo strip. Only the first few posters are kept: a popular performer has
// dozens, and this is a header, not an archive.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function importGallery(slug: string, posters: any): Promise<void> {
  if (!Array.isArray(posters) || posters.length === 0) return;
  const existing = db
    .prepare("SELECT COUNT(*) AS n FROM video_performer_images WHERE performer_slug = ?")
    .get(slug) as { n: number };
  if (existing.n > 0) return; // already imported; a refresh keeps what it has

  const ordered = [...posters]
    .filter((p) => p && typeof p.url === "string")
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .slice(0, GALLERY_LIMIT);

  const insert = db.prepare(
    "INSERT OR REPLACE INTO video_performer_images (performer_slug, idx, image_key) VALUES (?, ?, ?)"
  );
  let idx = 0;
  for (const poster of ordered) {
    try {
      await assertPublicUrl(new URL(poster.url));
      const res = await fetch(poster.url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) continue;
      const name = `performer_${slug}_${idx}.jpg`;
      await sharp(buf)
        .resize({ width: 700, withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toFile(posterFilePath(name));
      insert.run(slug, idx, name);
      idx++;
    } catch {
      /* one bad image must not abort the strip */
    }
  }
}

export function performerImage(slug: string, idx: number): string | null {
  const row = db
    .prepare(
      "SELECT image_key FROM video_performer_images WHERE performer_slug = ? AND idx = ?"
    )
    .get(slug, idx) as { image_key: string } | undefined;
  return row?.image_key ?? null;
}

export function performerImageIndices(slug: string): number[] {
  return (
    db
      .prepare(
        "SELECT idx FROM video_performer_images WHERE performer_slug = ? ORDER BY idx"
      )
      .all(slug) as { idx: number }[]
  ).map((r) => r.idx);
}

// Enrich everyone who has never been looked up. Runs as part of the metadata
// pass, within its time budget.
export async function enrichPendingPerformers(
  deadline: number
): Promise<number> {
  if (!tpdbConfigured()) return 0;
  let enriched = 0;
  for (;;) {
    if (Date.now() >= deadline) break;
    // Hand-made profiles are stamped as checked at creation, and excluded here
    // as well: nothing automatic may overwrite a field someone typed in.
    const row = db
      .prepare(
        "SELECT slug FROM video_performers WHERE checked_at IS NULL AND manual = 0 ORDER BY name LIMIT 1"
      )
      .get() as { slug: string } | undefined;
    if (!row) break;
    if (await enrichPerformer(row.slug)) enriched++;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return enriched;
}

// --- queries ----------------------------------------------------------------

// LEFT JOIN, not JOIN: a hand-made profile with no film yet still belongs in
// the index — otherwise a performer you just created appears to vanish.
export function listPerformers(): PerformerWithCount[] {
  return db
    .prepare(
      `SELECT p.*, COUNT(l.video_id) AS video_count
         FROM video_performers p
         LEFT JOIN video_performer_links l ON l.performer_slug = p.slug
        GROUP BY p.slug
        ORDER BY video_count DESC, p.name COLLATE NOCASE ASC`
    )
    .all() as PerformerWithCount[];
}

export function getPerformer(slug: string): PerformerDetail | undefined {
  const row = db
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM video_performer_links l
                     WHERE l.performer_slug = p.slug) AS video_count
         FROM video_performers p WHERE p.slug = ?`
    )
    .get(slug) as PerformerWithCount | undefined;
  if (!row) return undefined;
  return { ...row, images: performerImageIndices(slug) };
}

export function performerVideos(slug: string, userId: number) {
  return db
    .prepare(
      `SELECT v.*, COALESCE(pr.position, 0) AS position,
              COALESCE(pr.percent, 0) AS percent
         FROM videos v
         JOIN video_performer_links l ON l.video_id = v.id
         LEFT JOIN video_progress pr ON pr.video_id = v.id AND pr.user_id = @userId
        WHERE l.performer_slug = @slug AND v.channel = 'adults'
        ORDER BY v.meta_date DESC, v.added_at DESC`
    )
    .all({ slug, userId }) as (VideoRow & { position: number; percent: number })[];
}

// Performers credited on a video, for the watch page's links.
export function performersForVideo(videoId: number): VideoPerformerRow[] {
  return db
    .prepare(
      `SELECT p.* FROM video_performers p
         JOIN video_performer_links l ON l.performer_slug = p.slug
        WHERE l.video_id = ?
        ORDER BY p.name COLLATE NOCASE ASC`
    )
    .all(videoId) as VideoPerformerRow[];
}

// --- hand-made profiles -----------------------------------------------------
//
// Everything above assembles a profile from a release folder or ThePornDB.
// What follows is the other direction: profiles typed in by an admin, and the
// cast list they attach by hand. Both carry `manual = 1` so the automatic
// passes treat them as data they do not own — never pruned, never overwritten.

// Text fields an admin can fill in, in the order the profile page shows them.
export const PERFORMER_TEXT_FIELDS = [
  "name",
  "full_name",
  "disambiguation",
  "bio",
  "gender",
  "birthday",
  "deathday",
  "astrology",
  "birthplace",
  "nationality",
  "ethnicity",
  "cupsize",
  "hair_colour",
  "eye_colour",
  "height",
  "weight",
  "measurements",
  "waist",
  "hips",
  "tattoos",
  "piercings",
] as const;

export type PerformerTextField = (typeof PERFORMER_TEXT_FIELDS)[number];

export interface PerformerInput {
  name?: string;
  full_name?: string | null;
  disambiguation?: string | null;
  bio?: string | null;
  gender?: string | null;
  birthday?: string | null;
  deathday?: string | null;
  astrology?: string | null;
  birthplace?: string | null;
  nationality?: string | null;
  ethnicity?: string | null;
  cupsize?: string | null;
  hair_colour?: string | null;
  eye_colour?: string | null;
  height?: string | null;
  weight?: string | null;
  measurements?: string | null;
  waist?: string | null;
  hips?: string | null;
  tattoos?: string | null;
  piercings?: string | null;
  fake_boobs?: boolean | null;
  same_sex_only?: boolean | null;
  career_start?: number | null;
  career_end?: number | null;
  rating?: number | null;
  aliases?: string[];
  links?: { key: string; value: string }[];
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 4000) : null;
}

function cleanYear(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1900 && n <= 2200 ? n : null;
}

function cleanRating(value: unknown): number | null {
  // Number(null) and Number("") are both 0, so an unset rating would otherwise
  // be stored as a real zero and render as a 0.0 star row.
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 5 ? Math.round(n * 10) / 10 : null;
}

function cleanFlag(value: unknown): number | null {
  return typeof value === "boolean" ? (value ? 1 : 0) : null;
}

// A slug is a primary key that links, images and URLs all point at, so it is
// derived once at creation and never re-derived on rename.
function freeSlug(name: string): string {
  const base = performerSlug(name);
  let slug = base;
  for (let n = 2; ; n++) {
    const taken = db
      .prepare("SELECT 1 FROM video_performers WHERE slug = ?")
      .get(slug);
    if (!taken) return slug;
    slug = `${base}-${n}`.slice(0, 80);
  }
}

// Create a profile by hand. `checked_at` is stamped so the hourly enrichment
// pass leaves it alone — the Refresh button on the profile is the only way a
// hand-typed field gets replaced by ThePornDB's version of it.
export function createPerformer(input: PerformerInput): string {
  const name = cleanText(input.name);
  if (!name) throw new Error("A name is required");
  const slug = freeSlug(name);
  db.prepare(
    `INSERT INTO video_performers (slug, name, manual, checked_at)
     VALUES (?, ?, 1, datetime('now'))`
  ).run(slug, name);
  updatePerformer(slug, { ...input, name });
  return slug;
}

// Create a profile from a ThePornDB identifier: the record supplies the name,
// and the usual enrichment fills in everything else, portrait and photo strip
// included. Still `manual`, because nothing automatic would have created it.
export async function createPerformerFromTpdb(
  tpdbId: string
): Promise<string | null> {
  const found = await tpdbPerformerById(tpdbId);
  const name = cleanText(found?.name);
  if (!name) return null;
  const slug = createPerformer({ name });
  db.prepare("UPDATE video_performers SET tpdb_id = ? WHERE slug = ?").run(
    String(found.id ?? tpdbId),
    slug
  );
  await enrichPerformer(slug, tpdbId);
  return slug;
}

// Patch a profile: only the keys present in the payload are touched, so the
// form can send a subset and an untouched field keeps whatever the API found.
export function updatePerformer(slug: string, input: PerformerInput): void {
  const sets: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: Record<string, any> = { slug };

  for (const field of PERFORMER_TEXT_FIELDS) {
    if (!(field in input)) continue;
    const value = cleanText(input[field]);
    if (field === "name" && !value) continue; // a profile without a name is unusable
    sets.push(`${field} = @${field}`);
    params[field] = value;
  }
  if ("fake_boobs" in input) {
    sets.push("fake_boobs = @fake_boobs");
    params.fake_boobs = cleanFlag(input.fake_boobs);
  }
  if ("same_sex_only" in input) {
    sets.push("same_sex_only = @same_sex_only");
    params.same_sex_only = cleanFlag(input.same_sex_only);
  }
  if ("career_start" in input) {
    sets.push("career_start = @career_start");
    params.career_start = cleanYear(input.career_start);
  }
  if ("career_end" in input) {
    sets.push("career_end = @career_end");
    params.career_end = cleanYear(input.career_end);
  }
  if ("rating" in input) {
    sets.push("rating = @rating");
    params.rating = cleanRating(input.rating);
  }
  if ("aliases" in input) {
    const list = (input.aliases || [])
      .map((a) => cleanText(a))
      .filter((a): a is string => a !== null);
    sets.push("aliases = @aliases");
    params.aliases = list.length ? JSON.stringify(list) : null;
  }
  if ("links" in input) {
    // Same rule as the imported links: only http(s) is ever stored, because
    // these end up as hrefs on the profile page.
    const list = (input.links || [])
      .map((l) => ({ key: cleanText(l?.key) || "Link", value: safeHttpUrl(l?.value) }))
      .filter((l): l is { key: string; value: string } => l.value !== null);
    sets.push("links = @links");
    params.links = list.length ? JSON.stringify(list) : null;
  }

  if (!sets.length) return;
  db.prepare(
    `UPDATE video_performers SET ${sets.join(", ")} WHERE slug = @slug`
  ).run(params);
}

function removePosterFile(key: string | null | undefined): void {
  if (!key) return;
  try {
    fs.rmSync(posterFilePath(key), { force: true });
  } catch {
    /* best effort: a missing file is the state we wanted anyway */
  }
}

// Drop a profile and everything stored for it. Links and gallery rows go with
// it through ON DELETE CASCADE; the image files need doing by hand.
export function deletePerformer(slug: string): void {
  const row = db
    .prepare("SELECT image_key FROM video_performers WHERE slug = ?")
    .get(slug) as { image_key: string | null } | undefined;
  if (!row) return;
  const gallery = db
    .prepare("SELECT image_key FROM video_performer_images WHERE performer_slug = ?")
    .all(slug) as { image_key: string }[];
  db.prepare("DELETE FROM video_performers WHERE slug = ?").run(slug);
  removePosterFile(row.image_key);
  for (const g of gallery) removePosterFile(g.image_key);
}

// Replace the portrait with an uploaded image. The key carries a version so the
// browser cannot keep serving the previous portrait from its day-long cache.
export async function savePerformerPortrait(
  slug: string,
  buffer: Buffer
): Promise<string | null> {
  const previous = (
    db.prepare("SELECT image_key FROM video_performers WHERE slug = ?").get(slug) as
      | { image_key: string | null }
      | undefined
  )?.image_key;
  const key = `performer_${slug}_p${Date.now().toString(36)}.jpg`;
  try {
    await sharp(buffer)
      .resize({ width: 500, height: 500, fit: "cover", position: "top" })
      .jpeg({ quality: 85 })
      .toFile(posterFilePath(key));
  } catch {
    return null;
  }
  db.prepare("UPDATE video_performers SET image_key = ? WHERE slug = ?").run(
    key,
    slug
  );
  if (previous !== key) removePosterFile(previous);
  return key;
}

// Append a photo to the strip. Indices only ever count up, so deleting one and
// adding another never reuses a URL a browser has already cached.
export async function addPerformerImage(
  slug: string,
  buffer: Buffer
): Promise<number | null> {
  const max = db
    .prepare(
      "SELECT COALESCE(MAX(idx), -1) AS idx FROM video_performer_images WHERE performer_slug = ?"
    )
    .get(slug) as { idx: number };
  const idx = max.idx + 1;
  const key = `performer_${slug}_g${idx}_${Date.now().toString(36)}.jpg`;
  try {
    await sharp(buffer)
      .resize({ width: 700, withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toFile(posterFilePath(key));
  } catch {
    return null;
  }
  db.prepare(
    "INSERT OR REPLACE INTO video_performer_images (performer_slug, idx, image_key) VALUES (?, ?, ?)"
  ).run(slug, idx, key);
  return idx;
}

export function removePerformerImage(slug: string, idx: number): void {
  const row = db
    .prepare(
      "SELECT image_key FROM video_performer_images WHERE performer_slug = ? AND idx = ?"
    )
    .get(slug, idx) as { image_key: string } | undefined;
  if (!row) return;
  db.prepare(
    "DELETE FROM video_performer_images WHERE performer_slug = ? AND idx = ?"
  ).run(slug, idx);
  removePosterFile(row.image_key);
}

// The cast an admin edited by hand on a watch page: the list given here is the
// whole cast afterwards. A name that was added by hand is marked manual so a
// later rematch keeps it; a name that came from the metadata keeps its own
// mark, so correcting the film's match can still correct its credits.
export function setManualVideoPerformers(videoId: number, slugs: string[]): void {
  const known = slugs.filter(
    (slug) =>
      typeof slug === "string" &&
      db.prepare("SELECT 1 FROM video_performers WHERE slug = ?").get(slug)
  );
  const link = db.prepare(
    `INSERT OR IGNORE INTO video_performer_links (video_id, performer_slug, manual)
     VALUES (?, ?, 1)`
  );
  for (const slug of known) link.run(videoId, slug);
  const placeholders = known.map(() => "?").join(", ");
  db.prepare(
    `DELETE FROM video_performer_links
      WHERE video_id = ?${
        known.length ? ` AND performer_slug NOT IN (${placeholders})` : ""
      }`
  ).run(videoId, ...known);
  pruneOrphanPerformers();
}
