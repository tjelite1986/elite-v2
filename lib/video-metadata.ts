import fs from "node:fs";
import sharp from "sharp";
import { db } from "./db";
import type { VideoRow } from "./db";
import { artworkStem, posterFilePath, videoFilePath } from "./videos-storage";
import { findLocalPoster, readNfo, type NfoData } from "./video-nfo";
import { safeHttpUrl } from "./safe-url";
import {
  backfillPerformerLinks,
  enrichPendingPerformers,
  importLocalPortraits,
  setVideoPerformers,
} from "./video-performers";
import {
  findMatches,
  getTpdb,
  isConfident,
  tpdbConfigured,
  type ScoredResult,
  type TpdbResult,
  type TpdbType,
} from "./tpdb";

// Metadata for the 18+ video library, matched against ThePornDB. Matching is
// deliberately two-tier: a strict automatic pass that only applies obvious
// matches, and a manual picker for everything else — a wrong auto-match is
// worse than no match, because nobody goes back to check it.

export interface VideoMetadata {
  source: string | null;
  id: string | null;
  type: string | null;
  title: string | null;
  date: string | null;
  studio: string | null;
  synopsis: string | null;
  performers: string[];
  tags: string[];
  url: string | null;
  status: string | null;
  checkedAt: string | null;
  hasPoster: boolean;
}

export function parseMetadata(row: VideoRow): VideoMetadata {
  const list = (json: string | null): string[] => {
    if (!json) return [];
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  };
  return {
    source: row.meta_source,
    id: row.meta_id,
    type: row.meta_type,
    title: row.meta_title,
    date: row.meta_date,
    studio: row.meta_studio,
    synopsis: row.meta_synopsis,
    performers: list(row.meta_performers),
    tags: list(row.meta_tags),
    url: row.meta_url,
    status: row.meta_status,
    checkedAt: row.meta_checked_at,
    hasPoster: Boolean(row.meta_poster_key),
  };
}

// Cover art has to be served from our own origin: the app's CSP is img-src
// 'self', so a CDN URL would simply render broken. Downloaded next to the
// generated artwork, under a name derived from the storage key like the rest.
async function downloadPoster(
  row: VideoRow,
  url: string | null
): Promise<string | null> {
  if (!url) return null;
  const name = `${artworkStem(row.channel, row.storage_key)}_meta.jpg`;
  const dest = posterFilePath(name);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "";
    if (!type.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return null;
    fs.writeFileSync(dest, buf);
    return name;
  } catch {
    return null;
  }
}

function deleteMetaPoster(row: VideoRow) {
  if (!row.meta_poster_key) return;
  try {
    fs.rmSync(posterFilePath(row.meta_poster_key), { force: true });
  } catch {
    /* best effort */
  }
}

export async function applyMatch(
  row: VideoRow,
  match: TpdbResult,
  status: "auto" | "manual"
): Promise<void> {
  deleteMetaPoster(row);
  const posterKey = await downloadPoster(row, match.posterUrl);
  db.prepare(
    `UPDATE videos SET meta_source = 'tpdb', meta_id = @id, meta_type = @type,
       meta_title = @title, meta_date = @date, meta_studio = @studio,
       meta_synopsis = @synopsis, meta_performers = @performers,
       meta_tags = @tags, meta_poster_key = @poster, meta_url = @url,
       meta_status = @status, meta_checked_at = datetime('now')
     WHERE id = @videoId`
  ).run({
    videoId: row.id,
    id: match.id,
    type: match.type,
    title: match.title || null,
    date: match.date,
    studio: match.studio,
    synopsis: match.synopsis,
    performers: JSON.stringify(match.performers),
    tags: JSON.stringify(match.tags),
    poster: posterKey,
    url: safeHttpUrl(match.url),
    status,
  });
  setVideoPerformers(row.id, match.performers);
  await importLocalPortraits(row, match.performers);
}

export function clearMetadata(row: VideoRow): void {
  deleteMetaPoster(row);
  setVideoPerformers(row.id, []);
  db.prepare(
    `UPDATE videos SET meta_source = NULL, meta_id = NULL, meta_type = NULL,
       meta_title = NULL, meta_date = NULL, meta_studio = NULL,
       meta_synopsis = NULL, meta_performers = NULL, meta_tags = NULL,
       meta_poster_key = NULL, meta_url = NULL, meta_status = NULL,
       meta_checked_at = NULL
     WHERE id = ?`
  ).run(row.id);
}

// Apply a specific TPDB entry the user picked in the UI.
export async function applyMatchById(
  row: VideoRow,
  tpdbId: string,
  type: TpdbType
): Promise<boolean> {
  const match = await getTpdb(tpdbId, type);
  if (!match) return false;
  await applyMatch(row, match, "manual");
  return true;
}

// Candidates for the manual picker. `query` overrides the file's own title so
// the user can retype it when the filename is unhelpful.
export async function candidatesFor(
  row: VideoRow,
  query?: string
): Promise<ScoredResult[]> {
  const title = (query || row.meta_title || row.title).trim();
  return findMatches(title, row.duration);
}

// --- automatic pass ---------------------------------------------------------

export interface MetadataRunSummary {
  finishedAt: string;
  matched: number;
  unmatched: number;
  message: string;
}

let matching = false;
let lastMetadataRun: MetadataRunSummary | null = null;

export function metadataState(): {
  configured: boolean;
  running: boolean;
  pending: number;
  lastRun: MetadataRunSummary | null;
} {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n FROM videos WHERE channel = 'adults' AND meta_status IS NULL"
    )
    .get() as { n: number };
  return {
    configured: tpdbConfigured(),
    running: matching,
    pending: row.n,
    lastRun: lastMetadataRun,
  };
}

// Match every unmatched 18+ video. Videos that find nothing convincing are
// marked 'none' so the pass doesn't hammer the API with the same lookups every
// hour; the manual picker (and Rematch) still works on them.
async function runAutoMatch(budgetMs: number): Promise<MetadataRunSummary> {
  const deadline = Date.now() + budgetMs;
  let matched = 0;
  let unmatched = 0;

  // Self-heal first: films matched before performer profiles existed are
  // already 'auto', so the loop below would never look at them again.
  const backfilled = await backfillPerformerLinks();

  for (;;) {
    if (Date.now() >= deadline) break;
    const row = db
      .prepare(
        `SELECT * FROM videos
          WHERE channel = 'adults' AND meta_status IS NULL
          ORDER BY id ASC LIMIT 1`
      )
      .get() as VideoRow | undefined;
    if (!row) break;

    try {
      // A sidecar beats a search every time: no network, no ambiguity.
      if (await applyNfo(row)) {
        matched++;
        continue;
      }
      const results = await candidatesFor(row);
      const best = results[0];
      if (best && isConfident(best)) {
        await applyMatch(row, best, "auto");
        matched++;
      } else {
        db.prepare(
          "UPDATE videos SET meta_status = 'none', meta_checked_at = datetime('now') WHERE id = ?"
        ).run(row.id);
        unmatched++;
      }
    } catch {
      // A lookup failure must not spin on the same row forever.
      db.prepare(
        "UPDATE videos SET meta_status = 'none', meta_checked_at = datetime('now') WHERE id = ?"
      ).run(row.id);
      unmatched++;
    }

    // Be a polite API client.
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Whatever budget is left goes on performer biographies and portraits.
  const performers = await enrichPendingPerformers(deadline);

  return {
    finishedAt: new Date().toISOString(),
    matched,
    unmatched,
    message:
      `${matched} matched, ${unmatched} left without a match` +
      (backfilled ? `, ${backfilled} film${backfilled === 1 ? "" : "s"} linked to performers` : "") +
      (performers ? `, ${performers} performer profile${performers === 1 ? "" : "s"} filled in.` : "."),
  };
}

// Start-and-return, like the transcode queue: a full pass is many API calls and
// outlives the HTTP request that asked for it.
export function startMetadataRun(budgetMs = 20 * 60_000): {
  started: boolean;
  message: string;
} {
  if (!tpdbConfigured()) {
    return { started: false, message: "TPDB_API_KEY is not set." };
  }
  if (matching) {
    return { started: false, message: "A metadata run is already in progress." };
  }
  matching = true;
  void runAutoMatch(budgetMs)
    .then((summary) => {
      lastMetadataRun = summary;
    })
    .catch((err) => {
      lastMetadataRun = {
        finishedAt: new Date().toISOString(),
        matched: 0,
        unmatched: 0,
        message: `Run aborted: ${String((err as Error)?.message || err)}`,
      };
    })
    .finally(() => {
      matching = false;
    });
  return { started: true, message: "Matching metadata in the background." };
}

// --- local sidecars ---------------------------------------------------------

// Import the artwork that shipped with the file, converted to JPEG so every
// poster the app serves is the same format. Returns the stored filename.
async function importLocalPoster(
  row: VideoRow,
  sourcePath: string
): Promise<string | null> {
  const name = `${artworkStem(row.channel, row.storage_key)}_meta.jpg`;
  try {
    await sharp(sourcePath)
      .resize({ width: 640, withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toFile(posterFilePath(name));
    return name;
  } catch {
    return null;
  }
}

// Apply a .nfo sidecar. This is the best source there is — Whisparr wrote it
// from the same database the API serves, so it needs no search, no scoring and
// no network. Returns false when there is no usable sidecar.
export async function applyNfo(row: VideoRow): Promise<boolean> {
  const videoPath = videoFilePath(row.channel, row.storage_key);
  const nfo: NfoData | null = readNfo(videoPath);
  if (!nfo) return false;

  deleteMetaPoster(row);
  const localPoster = findLocalPoster(videoPath);
  const posterKey = localPoster
    ? await importLocalPoster(row, localPoster)
    : null;

  db.prepare(
    `UPDATE videos SET meta_source = 'nfo', meta_id = @id, meta_type = @type,
       meta_title = @title, meta_date = @date, meta_studio = @studio,
       meta_synopsis = @synopsis, meta_performers = @performers,
       meta_tags = @tags, meta_poster_key = @poster, meta_url = @url,
       meta_status = 'auto', meta_checked_at = datetime('now')
     WHERE id = @videoId`
  ).run({
    videoId: row.id,
    id: nfo.tpdbId,
    type: nfo.tpdbType,
    title: nfo.title,
    date: nfo.date,
    studio: nfo.studio,
    synopsis: nfo.plot,
    performers: JSON.stringify(nfo.performers),
    tags: JSON.stringify(nfo.tags),
    poster: posterKey,
    url: safeHttpUrl(nfo.sourceUrl),
  });
  setVideoPerformers(row.id, nfo.performers);
  await importLocalPortraits(row, nfo.performers);
  return true;
}

// Put a video back in the automatic queue (the Rematch button).
export function requeueMetadata(id: number): void {
  db.prepare(
    "UPDATE videos SET meta_status = NULL WHERE id = ? AND channel = 'adults'"
  ).run(id);
}
