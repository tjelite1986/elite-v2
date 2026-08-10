// The Movie Database, for everything ThePornDB has nothing to say about: the
// main channel's films and series, and the 18+ shelf's older cinema releases
// (a Swedish feature from 1978 is a film first and an adult title second).
//
// Same shape as the ThePornDB client on purpose — lib/video-metadata.ts stores
// whichever answer it gets in the same columns, so a match is a match whoever
// supplied it.

const API_BASE = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p/w780";

export type TmdbType = "movie" | "tv";

export interface TmdbResult {
  id: string; // "603" for a film, "1396:1:2" for one episode
  type: TmdbType;
  title: string;
  date: string | null;
  duration: number | null; // seconds, to match the probe's unit
  studio: string | null;
  synopsis: string | null;
  posterUrl: string | null;
  performers: string[];
  tags: string[];
  url: string | null;
  rating: number | null; // 0–5, as the UI's star row expects
  // Not stored: the record's own-language title, which is what a Swedish film's
  // filename actually says. Searching finds it; the response returns English.
  altTitle?: string | null;
}

export interface ScoredTmdb extends TmdbResult {
  score: number;
  titleScore: number;
  yearMatch: boolean | null;
  durationDelta: number | null;
}

export function tmdbConfigured(): boolean {
  return Boolean(process.env.TMDB_API_KEY);
}

function apiKey(): string {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw new Error("TMDB_API_KEY is not set");
  return key;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function get(path: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(API_BASE + path);
  url.searchParams.set("api_key", apiKey());
  url.searchParams.set("language", "en-US");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`TMDB ${res.status} for ${path}`);
  return res.json();
}

// --- reading a filename ------------------------------------------------------

// Everything a release name puts after the title. The first one that appears
// marks where the title ends — "Alien 1979 1080p BluRay x264-GROUP" is "Alien".
const JUNK =
  /\b(1080p|2160p|720p|480p|4k|uhd|hdr10?|dv|bluray|blu-ray|brrip|bdrip|webrip|web-dl|webdl|web|hdtv|dvdrip|dvd|remux|x264|x265|h ?264|h ?265|hevc|avc|xvid|divx|aac\d?|ac3|dts(-hd)?|truehd|atmos|ddp?\d(\.\d)?|flac|mp3|10bit|8bit|hdrip|cam|ts|proper|repack|extended|uncut|unrated|remastered|imax|limited|internal|multi|dual|dubbed|subbed|complete|season|part\d)\b/i;

function tidy(raw: string): string {
  return raw
    .replace(/\.[a-z0-9]{2,4}$/i, "") // extension
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ParsedName {
  title: string;
  year: number | null;
  season: number | null;
  episode: number | null;
}

// Pull a searchable title (and, when present, a season/episode) out of a file
// or folder name. Deliberately conservative: a title cut too short still finds
// the film, a title left full of release junk finds nothing.
export function parseVideoName(storageKey: string): ParsedName {
  const base = storageKey.split("/").pop() || storageKey;
  let name = tidy(base);

  // The parent folder is often the better name ("Alien (1979)/video.mkv").
  const parts = storageKey.split("/");
  if (parts.length > 1 && /^(video|movie|film|title\d*|\d{1,3})$/i.test(name)) {
    name = tidy(parts[parts.length - 2]);
  }

  const episodeMatch =
    /\bs(\d{1,2})[\s._-]*e(\d{1,3})\b/i.exec(name) ||
    /\b(\d{1,2})x(\d{2,3})\b/i.exec(name);
  const season = episodeMatch ? Number(episodeMatch[1]) : null;
  const episode = episodeMatch ? Number(episodeMatch[2]) : null;
  if (episodeMatch) name = name.slice(0, episodeMatch.index).trim();

  // A year in the name is the strongest disambiguator there is, so it is taken
  // out of the title and kept as its own signal.
  let year: number | null = null;
  const yearMatch = /[([]?\b(19\d{2}|20\d{2})\b[)\]]?/.exec(name);
  if (yearMatch) {
    year = Number(yearMatch[1]);
    name = name.slice(0, yearMatch.index).trim();
  } else {
    const junk = JUNK.exec(name);
    if (junk && junk.index > 0) name = name.slice(0, junk.index).trim();
  }

  const title = name
    .replace(/[-–—([{]+\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return { title: title || tidy(base), year, season, episode };
}

// --- normalising a record ----------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function names(list: any): string[] {
  return Array.isArray(list)
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      list.map((p: any) => p?.name).filter((n: unknown): n is string => Boolean(n))
    : [];
}

function image(path: unknown): string | null {
  return typeof path === "string" && path ? IMAGE_BASE + path : null;
}

function stars(vote: unknown): number | null {
  const n = Number(vote);
  return Number.isFinite(n) && n > 0 ? Math.round((n / 2) * 10) / 10 : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeMovie(item: any, detailed = false): TmdbResult {
  return {
    id: String(item.id),
    type: "movie",
    title: String(item.title || item.original_title || "").trim(),
    altTitle: item.original_title ? String(item.original_title).trim() : null,
    date: item.release_date || null,
    duration: detailed && item.runtime ? item.runtime * 60 : null,
    studio: names(item.production_companies)[0] ?? null,
    synopsis: (item.overview || "").trim() || null,
    posterUrl: image(item.poster_path) ?? image(item.backdrop_path),
    performers: names(item.credits?.cast).slice(0, 12),
    tags: names(item.genres),
    url: `https://www.themoviedb.org/movie/${item.id}`,
    rating: stars(item.vote_average),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeShow(item: any, detailed = false): TmdbResult {
  const runtime = Array.isArray(item.episode_run_time) ? item.episode_run_time[0] : null;
  return {
    id: String(item.id),
    type: "tv",
    title: String(item.name || item.original_name || "").trim(),
    altTitle: item.original_name ? String(item.original_name).trim() : null,
    date: item.first_air_date || null,
    duration: detailed && runtime ? runtime * 60 : null,
    studio: names(item.networks)[0] ?? null,
    synopsis: (item.overview || "").trim() || null,
    posterUrl: image(item.poster_path) ?? image(item.backdrop_path),
    performers: names(item.credits?.cast).slice(0, 12),
    tags: names(item.genres),
    url: `https://www.themoviedb.org/tv/${item.id}`,
    rating: stars(item.vote_average),
  };
}

// One episode, presented as its own record: "Show — 1x02 Title", because that
// is what the file on disk actually is.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeEpisode(show: any, ep: any, season: number, episode: number): TmdbResult {
  const label = `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
  return {
    id: `${show.id}:${season}:${episode}`,
    type: "tv",
    title: `${show.name || show.original_name} — ${label}${ep?.name ? ` ${ep.name}` : ""}`,
    date: ep?.air_date || show.first_air_date || null,
    duration: ep?.runtime ? ep.runtime * 60 : null,
    studio: names(show.networks)[0] ?? null,
    synopsis: (ep?.overview || show.overview || "").trim() || null,
    posterUrl: image(ep?.still_path) ?? image(show.poster_path),
    performers: [...names(ep?.credits?.cast), ...names(ep?.guest_stars)].slice(0, 12),
    tags: names(show.genres),
    url: `https://www.themoviedb.org/tv/${show.id}/season/${season}/episode/${episode}`,
    rating: stars(ep?.vote_average) ?? stars(show.vote_average),
  };
}

// --- lookups -----------------------------------------------------------------

// A record addressed by id. "603" is a film, "1396:1:2" one episode — the same
// string the store keeps, so a stored match can always be re-fetched.
export async function getTmdb(id: string, type: TmdbType): Promise<TmdbResult | null> {
  try {
    if (type === "tv") {
      const [showId, season, episode] = id.split(":");
      const show = await get(`/tv/${encodeURIComponent(showId)}`, {
        append_to_response: "credits",
      });
      if (!show?.id) return null;
      if (season === undefined || episode === undefined) {
        return normalizeShow(show, true);
      }
      const ep = await get(
        `/tv/${encodeURIComponent(showId)}/season/${Number(season)}/episode/${Number(episode)}`,
        { append_to_response: "credits" }
      );
      return normalizeEpisode(show, ep, Number(season), Number(episode));
    }
    const movie = await get(`/movie/${encodeURIComponent(id)}`, {
      append_to_response: "credits",
    });
    return movie?.id ? normalizeMovie(movie, true) : null;
  } catch {
    return null;
  }
}

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function titleSimilarity(a: string, b: string): number {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const xs = new Set(x.split(" "));
  const ys = new Set(y.split(" "));
  let shared = 0;
  for (const w of xs) if (ys.has(w)) shared++;
  const overlap = shared / Math.max(xs.size, ys.size);
  // A title that fully contains the other ("Alien" in "Alien Resurrection")
  // still has to lose points for the words it does not explain.
  return x.includes(y) || y.includes(x) ? Math.max(overlap, 0.75) : overlap;
}

export function scoreTmdb(
  candidate: TmdbResult,
  parsed: ParsedName,
  fileDuration: number | null
): ScoredTmdb {
  const titleScore = Math.max(
    titleSimilarity(parsed.title, candidate.title.split(" — ")[0]),
    candidate.altTitle ? titleSimilarity(parsed.title, candidate.altTitle) : 0
  );
  let score = titleScore;

  let yearMatch: boolean | null = null;
  if (parsed.year && candidate.date) {
    // Within a year counts: a film released in December is dated the next year
    // in half the world, and a DVD edition later still.
    yearMatch = Math.abs(Number(candidate.date.slice(0, 4)) - parsed.year) <= 1;
    score += yearMatch ? 0.25 : -0.3;
  }

  let durationDelta: number | null = null;
  if (fileDuration && candidate.duration) {
    durationDelta = Math.abs(fileDuration - candidate.duration);
    const relative = durationDelta / fileDuration;
    if (relative <= 0.05) score += 0.2;
    else if (relative <= 0.15) score += 0.05;
    else if (relative >= 0.4) score -= 0.3;
  }

  return {
    ...candidate,
    score: Math.max(0, Math.min(1, score)),
    titleScore,
    yearMatch,
    durationDelta,
  };
}

// Candidates for one file, best first. An episode filename resolves through the
// series to that exact episode; everything else is searched as a film and as a
// series, because a filename rarely says which it is.
export async function findTmdbMatches(
  parsed: ParsedName,
  fileDuration: number | null,
  limit = 10
): Promise<ScoredTmdb[]> {
  if (!parsed.title) return [];
  const out: TmdbResult[] = [];

  if (parsed.season !== null && parsed.episode !== null) {
    try {
      const shows = await get("/search/tv", { query: parsed.title, include_adult: "true" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const hit of (shows?.results || []).slice(0, 3) as any[]) {
        const detail = await getTmdb(
          `${hit.id}:${parsed.season}:${parsed.episode}`,
          "tv"
        );
        if (detail) out.push(detail);
      }
    } catch {
      /* fall through to the film search */
    }
  }

  const searches: [TmdbType, string, Record<string, string>][] = [
    ["movie", "/search/movie", parsed.year ? { year: String(parsed.year) } : {}],
    ["tv", "/search/tv", parsed.year ? { first_air_date_year: String(parsed.year) } : {}],
  ];
  for (const [type, path, extra] of searches) {
    try {
      const data = await get(path, {
        query: parsed.title,
        include_adult: "true",
        ...extra,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const hit of (data?.results || []).slice(0, 6) as any[]) {
        out.push(type === "movie" ? normalizeMovie(hit) : normalizeShow(hit));
      }
    } catch {
      continue; // one failing endpoint must not kill the whole lookup
    }
  }

  // A year filter that finds nothing is worse than no filter: releases are
  // dated differently in different countries. The year is dropped from the
  // QUERY only — it stays in the scoring, or a remake would sail through on
  // its title alone.
  if (out.length === 0 && parsed.year) {
    const retried = await findTmdbMatches({ ...parsed, year: null }, fileDuration, limit);
    return retried
      .map((r) => scoreTmdb(r, parsed, fileDuration))
      .sort((a, b) => b.score - a.score);
  }

  const seen = new Set<string>();
  return out
    .filter((r) => (seen.has(`${r.type}:${r.id}`) ? false : seen.add(`${r.type}:${r.id}`)))
    .map((r) => scoreTmdb(r, parsed, fileDuration))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// Good enough to apply without a human looking at it. A search hit carries no
// runtime, so the title has to be near-exact unless the year agrees too.
export function isConfidentTmdb(match: ScoredTmdb): boolean {
  if (match.yearMatch === false) return false;
  if (match.titleScore >= 0.95 && match.yearMatch === true) return true;
  if (match.titleScore >= 0.99) return true;
  return false;
}

export interface TmdbRef {
  id: string;
  type: TmdbType;
}

// "themoviedb.org/movie/603", ".../tv/1396/season/1/episode/2", "tmdb:603" or a
// bare id — the same escape hatch the ThePornDB client offers, for when a title
// is unsearchable but the record is known.
export function parseTmdbRef(input: string): TmdbRef | null {
  const raw = input.trim();
  if (!raw) return null;

  if (/^https?:\/\//i.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    if (!/(^|\.)themoviedb\.org$/i.test(url.hostname)) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    const kind = parts[0]?.toLowerCase();
    const id = (parts[1] || "").split("-")[0];
    if (!id) return null;
    if (kind === "movie") return { id, type: "movie" };
    if (kind === "tv") {
      const season = parts[2] === "season" ? parts[3] : undefined;
      const episode = parts[4] === "episode" ? parts[5] : undefined;
      return {
        id: season && episode ? `${id}:${Number(season)}:${Number(episode)}` : id,
        type: "tv",
      };
    }
    return null;
  }

  const prefixed = /^tmdb:(movie|tv)?:?\s*([0-9:]+)$/i.exec(raw);
  if (prefixed) {
    return { id: prefixed[2], type: prefixed[1]?.toLowerCase() === "tv" ? "tv" : "movie" };
  }
  if (/^\d{1,9}(:\d{1,3}:\d{1,4})?$/.test(raw)) {
    return { id: raw, type: raw.includes(":") ? "tv" : "movie" };
  }
  return null;
}

// The record behind a stored match, for the "TheMovieDB" link on a watch page.
export function tmdbUrl(id: string, type: string): string | null {
  if (!id) return null;
  if (type === "tv") {
    const [showId, season, episode] = id.split(":");
    return season !== undefined && episode !== undefined
      ? `https://www.themoviedb.org/tv/${showId}/season/${season}/episode/${episode}`
      : `https://www.themoviedb.org/tv/${showId}`;
  }
  return `https://www.themoviedb.org/movie/${id}`;
}
