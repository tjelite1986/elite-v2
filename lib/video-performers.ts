import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { db } from "./db";
import type { VideoPerformerRow, VideoRow } from "./db";
import { posterFilePath, videoFilePath } from "./videos-storage";
import { tpdbConfigured } from "./tpdb";

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
    return (data?.data || []).find((p: any) => performerSlug(p.name || "") === wanted) ?? null;
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

  db.prepare(
    `UPDATE video_performers SET tpdb_id = @tpdbId, bio = @bio, birthday = @birthday,
       birthplace = @birthplace, nationality = @nationality, height = @height,
       measurements = @measurements, hair_colour = @hair, eye_colour = @eye,
       career_start = @career, image_key = @image, checked_at = datetime('now')
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
    career: Number.isFinite(Number(extras.career_start_year))
      ? Number(extras.career_start_year)
      : null,
    image: imageKey,
  });
  return true;
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

export function getPerformer(slug: string): PerformerWithCount | undefined {
  return db
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM video_performer_links l
                     WHERE l.performer_slug = p.slug) AS video_count
         FROM video_performers p WHERE p.slug = ?`
    )
    .get(slug) as PerformerWithCount | undefined;
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
