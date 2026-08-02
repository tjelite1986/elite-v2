import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { db } from "./db";
import type { VideoPerformerRow, VideoRow } from "./db";
import { posterFilePath, videoFilePath } from "./videos-storage";
import { tpdbConfigured } from "./tpdb";
import { safeHttpUrl } from "./safe-url";

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
// the whole set, so removing a name from the metadata removes the link too.
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
  // Drop links this video no longer claims.
  const placeholders = slugs.map(() => "?").join(", ");
  db.prepare(
    `DELETE FROM video_performer_links
      WHERE video_id = ?${slugs.length ? ` AND performer_slug NOT IN (${placeholders})` : ""}`
  ).run(videoId, ...slugs);
  // A profile nobody links to any more is noise.
  db.prepare(
    `DELETE FROM video_performers
      WHERE slug NOT IN (SELECT performer_slug FROM video_performer_links)`
  ).run();
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

export async function enrichPerformer(slug: string): Promise<boolean> {
  const row = db
    .prepare("SELECT * FROM video_performers WHERE slug = ?")
    .get(slug) as VideoPerformerRow | undefined;
  if (!row) return false;

  const found = await tpdbPerformer(row.name);
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

  db.prepare(
    `UPDATE video_performers SET tpdb_id = @tpdbId, bio = @bio, birthday = @birthday,
       birthplace = @birthplace, nationality = @nationality, height = @height,
       measurements = @measurements, hair_colour = @hair, eye_colour = @eye,
       career_start = @careerStart, career_end = @careerEnd, gender = @gender,
       ethnicity = @ethnicity, cupsize = @cupsize, weight = @weight,
       waist = @waist, hips = @hips, tattoos = @tattoos, piercings = @piercings,
       fake_boobs = @fakeBoobs, same_sex_only = @sameSexOnly,
       astrology = @astrology, deathday = @deathday, full_name = @fullName,
       disambiguation = @disambiguation, rating = @rating, aliases = @aliases,
       links = @links, image_key = @image, checked_at = datetime('now')
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
    const row = db
      .prepare(
        "SELECT slug FROM video_performers WHERE checked_at IS NULL ORDER BY name LIMIT 1"
      )
      .get() as { slug: string } | undefined;
    if (!row) break;
    if (await enrichPerformer(row.slug)) enriched++;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return enriched;
}

// --- queries ----------------------------------------------------------------

export function listPerformers(): PerformerWithCount[] {
  return db
    .prepare(
      `SELECT p.*, COUNT(l.video_id) AS video_count
         FROM video_performers p
         JOIN video_performer_links l ON l.performer_slug = p.slug
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
        WHERE l.performer_slug = @slug
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
