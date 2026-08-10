import fs from "node:fs";
import sharp from "sharp";
import { db } from "./db";
import type { VideoRow } from "./db";
import { artworkStem, posterFilePath, videoFilePath } from "./videos-storage";
import { findLocalPoster, readNfo, type NfoData } from "./video-nfo";
import { safeHttpUrl } from "./safe-url";
import { assertPublicUrl } from "./link-preview";
import {
  backfillPerformerLinks,
  enrichPendingPerformers,
  importLocalPortraits,
  setVideoPerformers,
} from "./video-performers";
import {
  findMatches,
  getTpdb,
  getTpdbByRef,
  isConfident,
  parseTpdbRef,
  scoreResult,
  tpdbConfigured,
  type ScoredResult,
  type TpdbResult,
  type TpdbType,
} from "./tpdb";
import {
  findTmdbMatches,
  getTmdb,
  isConfidentTmdb,
  parseTmdbRef,
  parseVideoName,
  tmdbConfigured,
  type TmdbResult,
} from "./tmdb";

// Metadata for the video library. Matching is deliberately two-tier: a strict
// automatic pass that only applies obvious matches, and a manual picker for
// everything else — a wrong auto-match is worse than no match, because nobody
// goes back to check it.
//
// Two databases answer, by channel: ThePornDB for the 18+ shelf, TheMovieDB for
// the main one — and for an 18+ film TPDB has never heard of, which is how a
// 1978 cinema release gets described at all.

export interface SceneMarker {
  title: string;
  start: number;
  end: number | null;
}

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
  markers: SceneMarker[];
  rating: number | null;
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
    markers: (() => {
      if (!row.meta_markers) return [];
      try {
        const parsed = JSON.parse(row.meta_markers);
        return Array.isArray(parsed) ? (parsed as SceneMarker[]) : [];
      } catch {
        return [];
      }
    })(),
    rating: row.meta_rating,
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
    await assertPublicUrl(new URL(url));
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

// One shape for both providers: whoever answered, the answer lands in the same
// columns. `source` is what tells the UI which site to link back to, and which
// client can re-fetch the record later.
export type MetaProvider = "tpdb" | "tmdb";

export interface MatchCandidate {
  source: MetaProvider;
  id: string;
  type: string;
  title: string;
  date: string | null;
  duration: number | null;
  studio: string | null;
  synopsis: string | null;
  posterUrl: string | null;
  performers: string[];
  tags: string[];
  url: string | null;
  markers: SceneMarker[];
  rating: number | null;
}

export function fromTpdb(r: TpdbResult): MatchCandidate {
  return { ...r, source: "tpdb" };
}

export function fromTmdb(r: TmdbResult): MatchCandidate {
  const { altTitle: _altTitle, ...rest } = r;
  return { ...rest, source: "tmdb", markers: [] };
}

export async function applyMatch(
  row: VideoRow,
  candidate: MatchCandidate,
  status: "auto" | "manual"
): Promise<void> {
  // A search hit from TheMovieDB is a stub: no runtime, no studio, no genres
  // and no cast — those live only on the record itself. Fetch it before
  // storing, or an auto-matched film keeps an empty cast forever, since
  // nothing goes back to look at a row that already has a match.
  let match = candidate;
  if (match.source === "tmdb" && (!match.performers.length || !match.duration)) {
    const full = await getTmdb(match.id, match.type === "tv" ? "tv" : "movie");
    if (full) match = fromTmdb(full);
  }
  deleteMetaPoster(row);
  const posterKey = await downloadPoster(row, match.posterUrl);
  db.prepare(
    `UPDATE videos SET meta_source = @source, meta_id = @id, meta_type = @type,
       meta_title = @title, meta_date = @date, meta_studio = @studio,
       meta_synopsis = @synopsis, meta_performers = @performers,
       meta_tags = @tags, meta_poster_key = @poster, meta_url = @url,
       meta_markers = @markers, meta_rating = @rating,
       meta_status = @status, meta_checked_at = datetime('now')
     WHERE id = @videoId`
  ).run({
    videoId: row.id,
    source: match.source,
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
    markers: match.markers.length ? JSON.stringify(match.markers) : null,
    rating: match.rating,
    status,
  });
  // Performer profiles are an 18+ concept: the main channel credits actors,
  // who have nothing to do with the gated /videos18/performer pages.
  if (row.channel === "adults") {
    setVideoPerformers(row.id, match.performers);
    await importLocalPortraits(row, match.performers);
  }
}

export function clearMetadata(row: VideoRow): void {
  deleteMetaPoster(row);
  if (row.channel === "adults") setVideoPerformers(row.id, []);
  db.prepare(
    `UPDATE videos SET meta_source = NULL, meta_id = NULL, meta_type = NULL,
       meta_title = NULL, meta_date = NULL, meta_studio = NULL,
       meta_synopsis = NULL, meta_performers = NULL, meta_tags = NULL,
       meta_poster_key = NULL, meta_url = NULL, meta_status = NULL,
       meta_checked_at = NULL
     WHERE id = ?`
  ).run(row.id);
}

// Apply a specific entry the user picked in the UI, from either database.
export async function applyMatchById(
  row: VideoRow,
  id: string,
  type: string,
  source: MetaProvider = "tpdb"
): Promise<boolean> {
  if (source === "tmdb") {
    const found = await getTmdb(id, type === "tv" ? "tv" : "movie");
    if (!found) return false;
    await applyMatch(row, fromTmdb(found), "manual");
    return true;
  }
  const match = await getTpdb(id, type === "scene" ? "scene" : "movie");
  if (!match) return false;
  await applyMatch(row, fromTpdb(match), "manual");
  return true;
}

export interface ScoredCandidate extends MatchCandidate {
  score: number;
  durationDelta: number | null;
  // Decided by the database that produced it, while its own evidence is still
  // at hand: a scene has a runtime to check against, a film has a year.
  confident: boolean;
}

// Candidates from TheMovieDB. The file's own name carries the year and any
// season/episode, so a retyped query only replaces the title part.
async function tmdbCandidates(
  row: VideoRow,
  query?: string
): Promise<ScoredCandidate[]> {
  if (!tmdbConfigured()) return [];
  const parsed = parseVideoName(row.storage_key);
  if (query) {
    const retyped = parseVideoName(query);
    parsed.title = retyped.title || query.trim();
    if (retyped.year) parsed.year = retyped.year;
    if (retyped.season !== null) {
      parsed.season = retyped.season;
      parsed.episode = retyped.episode;
    }
  }

  // A themoviedb.org link or a bare id addresses one exact record.
  const ref = query ? parseTmdbRef(query) : null;
  if (ref) {
    const found = await getTmdb(ref.id, ref.type);
    return found
      ? [{ ...fromTmdb(found), score: 1, durationDelta: null, confident: true }]
      : [];
  }

  const results = await findTmdbMatches(parsed, row.duration);
  return results.map((r) => ({
    ...fromTmdb(r),
    score: r.score,
    durationDelta: r.durationDelta,
    confident: isConfidentTmdb(r),
  }));
}

// Candidates for the manual picker, from whichever database can speak for this
// channel. `query` overrides the file's own title so the user can retype it
// when the filename is unhelpful.
export async function candidatesFor(
  row: VideoRow,
  query?: string
): Promise<ScoredCandidate[]> {
  const title = (query || row.meta_title || row.title).trim();

  if (row.channel !== "adults") return tmdbCandidates(row, query);

  // An id, a "scenes/224654" reference or a theporndb.net URL addresses one
  // exact record — no search, no scoring, no ambiguity. This is the way out
  // when the title is unsearchable and the right record is known.
  const ref = parseTpdbRef(title);
  if (ref && ref.type !== "performer") {
    const found = await getTpdbByRef(ref);
    if (found) {
      const scored = scoreResult(found, found.title, row.duration);
      return [
        {
          ...fromTpdb(scored),
          score: scored.score,
          durationDelta: scored.durationDelta,
          confident: true, // the user named the record; there is nothing to guess
        },
      ];
    }
    return [];
  }

  const tpdb = tpdbConfigured() ? await findMatches(title, row.duration) : [];
  const scored: ScoredCandidate[] = tpdb.map((r) => ({
    ...fromTpdb(r),
    score: r.score,
    durationDelta: r.durationDelta,
    confident: isConfident(r),
  }));
  // Only when that database has nothing: an adult film it does not know is
  // usually a cinema release, and those live in TheMovieDB.
  if (scored.length) return scored;
  return tmdbCandidates(row, query);
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
    .prepare("SELECT COUNT(*) AS n FROM videos WHERE meta_status IS NULL")
    .get() as { n: number };
  return {
    configured: tpdbConfigured() || tmdbConfigured(),
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
          WHERE meta_status IS NULL
          ORDER BY channel = 'adults' DESC, id ASC LIMIT 1`
      )
      .get() as VideoRow | undefined;
    if (!row) break;

    try {
      // A sidecar beats a search every time: no network, no ambiguity.
      if (row.channel === "adults" && (await applyNfo(row))) {
        matched++;
        continue;
      }
      const results = await candidatesFor(row);
      const best = results[0];
      if (best && best.confident) {
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

  // Chapter markers and ratings for films the sidecar identified but could not
  // describe, then whatever budget is left goes on performer profiles.
  const scenes = await enrichPendingScenes(deadline);
  const performers = await enrichPendingPerformers(deadline);

  return {
    finishedAt: new Date().toISOString(),
    matched,
    unmatched,
    message:
      `${matched} matched, ${unmatched} left without a match` +
      (backfilled ? `, ${backfilled} film${backfilled === 1 ? "" : "s"} linked to performers` : "") +
      (scenes ? `, ${scenes} with chapter markers` : "") +
      (performers ? `, ${performers} performer profile${performers === 1 ? "" : "s"} filled in.` : "."),
  };
}

// Start-and-return, like the transcode queue: a full pass is many API calls and
// outlives the HTTP request that asked for it.
export function startMetadataRun(budgetMs = 20 * 60_000): {
  started: boolean;
  message: string;
} {
  if (!tpdbConfigured() && !tmdbConfigured()) {
    return { started: false, message: "No metadata API key is configured." };
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

// A sidecar knows the film but not its chapter markers or community rating —
// only the API record does. When the sidecar handed us an id, fetch that record
// and fill in what it alone has, without touching the fields the sidecar owns.
export async function enrichFromTpdbId(row: VideoRow): Promise<boolean> {
  if (!row.meta_id || !row.meta_type) return false;
  if (row.meta_markers !== null) return false; // already fetched
  const detail = await getTpdb(row.meta_id, row.meta_type as TpdbType);
  if (!detail) {
    // Record an empty set so a record without markers is not re-fetched hourly.
    db.prepare("UPDATE videos SET meta_markers = '[]' WHERE id = ?").run(row.id);
    return false;
  }
  db.prepare(
    "UPDATE videos SET meta_markers = @markers, meta_rating = COALESCE(@rating, meta_rating) WHERE id = @id"
  ).run({
    id: row.id,
    markers: JSON.stringify(detail.markers),
    rating: detail.rating,
  });
  return detail.markers.length > 0;
}

async function enrichPendingScenes(deadline: number): Promise<number> {
  if (!tpdbConfigured()) return 0;
  let filled = 0;
  for (;;) {
    if (Date.now() >= deadline) break;
    const row = db
      .prepare(
        `SELECT * FROM videos
          WHERE channel = 'adults' AND meta_source = 'tpdb'
            AND meta_id IS NOT NULL AND meta_markers IS NULL
          ORDER BY id LIMIT 1`
      )
      .get() as VideoRow | undefined;
    if (!row) break;
    if (await enrichFromTpdbId(row)) filled++;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return filled;
}

// Put a video back in the automatic queue (the Rematch button).
export function requeueMetadata(id: number): void {
  db.prepare("UPDATE videos SET meta_status = NULL WHERE id = ?").run(id);
}
