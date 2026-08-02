// ThePornDB (theporndb.net) metadata lookup for the 18+ video library — the
// same source Whisparr uses, so files named the way Whisparr names them match
// well. Only the adults channel uses this; the main library has no business
// querying it.
//
// Two things learned from the live API and baked in below:
//   - Search is strict. "Magdalena - Absolut Sperma" returns nothing while
//     "Absolut Sperma" returns the film, so a title is tried in several
//     progressively-trimmed variants.
//   - The same film is often listed twice under sibling sites (GGG vs German
//     Goo Girls) with different runtimes, so the file's own duration is what
//     picks the right one.

const API_BASE = "https://api.theporndb.net";

export type TpdbType = "movie" | "scene";

export interface TpdbResult {
  id: string;
  type: TpdbType;
  title: string;
  date: string | null;
  duration: number | null;
  studio: string | null;
  synopsis: string | null;
  posterUrl: string | null;
  performers: string[];
  tags: string[];
  url: string | null;
}

export interface ScoredResult extends TpdbResult {
  score: number; // 0..1
  titleScore: number;
  durationDelta: number | null; // seconds, null when either side is unknown
}

export class TpdbNotConfiguredError extends Error {
  constructor() {
    super("TPDB_API_KEY is not set");
  }
}

function apiKey(): string {
  const key = process.env.TPDB_API_KEY;
  if (!key) throw new TpdbNotConfiguredError();
  return key;
}

export function tpdbConfigured(): boolean {
  return Boolean(process.env.TPDB_API_KEY);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function get(path: string, params: Record<string, string>): Promise<any> {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      Accept: "application/json",
    },
    // The API is occasionally slow; fail rather than hang a job forever.
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`TPDB ${res.status} for ${path}`);
  }
  return res.json();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeItem(item: any, type: TpdbType): TpdbResult {
  const images = item.background || {};
  return {
    id: String(item.id),
    type,
    title: String(item.title || "").trim(),
    date: item.date || null,
    duration:
      typeof item.duration === "number" && item.duration > 0
        ? item.duration
        : null,
    studio: item.site?.name || item.studio?.name || null,
    synopsis: (item.description || "").trim() || null,
    // Prefer a sized image over the full-resolution one: it is a card thumb.
    posterUrl:
      images.large || images.medium || item.poster || item.image || null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    performers: (item.performers || [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((p: any) => p?.name)
      .filter(Boolean),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tags: (item.tags || []).map((t: any) => t?.name).filter(Boolean),
    url: item.url || null,
  };
}

export async function searchTpdb(
  query: string,
  type: TpdbType = "movie"
): Promise<TpdbResult[]> {
  const path = type === "movie" ? "/movies" : "/scenes";
  const data = await get(path, { q: query });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data?.data || []).map((item: any) => normalizeItem(item, type));
}

export async function getTpdb(
  id: string,
  type: TpdbType
): Promise<TpdbResult | null> {
  const path = `${type === "movie" ? "/movies" : "/scenes"}/${encodeURIComponent(id)}`;
  try {
    const data = await get(path, {});
    return data?.data ? normalizeItem(data.data, type) : null;
  } catch {
    return null;
  }
}

// --- matching ---------------------------------------------------------------

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Query variants, most specific first. The API matches on the whole string, so
// a "Performer - Title" filename has to lose its prefix, and a de-duplicated
// download has to lose its "(2)" suffix, before anything is found.
export function queryVariants(title: string): string[] {
  const variants: string[] = [];
  const push = (s: string) => {
    const v = s.replace(/\s+/g, " ").trim();
    if (v.length >= 3 && !variants.includes(v)) variants.push(v);
  };

  const noCopy = title.replace(/\s*\((\d+)\)\s*$/, "");
  push(title);
  push(noCopy);
  // "Magdalena - Absolut Sperma" -> "Absolut Sperma"
  const dash = noCopy.split(/\s+-\s+/);
  if (dash.length > 1) push(dash.slice(1).join(" - "));
  return variants;
}

// Token-overlap similarity (0..1), symmetric enough for short film titles and
// tolerant of the punctuation TPDB adds ("3, 2, 1 ... Sperma Ist Meins!").
function titleSimilarity(a: string, b: string): number {
  const at = new Set(normalizeTitle(a).split(" ").filter(Boolean));
  const bt = new Set(normalizeTitle(b).split(" ").filter(Boolean));
  if (!at.size || !bt.size) return 0;
  let shared = 0;
  for (const t of at) if (bt.has(t)) shared++;
  return (2 * shared) / (at.size + bt.size);
}

// Confidence for one candidate. Title carries most of it; a runtime that agrees
// is what separates the duplicate listings, and one that clearly disagrees is
// what stops a same-title different-film match.
export function scoreResult(
  candidate: TpdbResult,
  fileTitle: string,
  fileDuration: number | null
): ScoredResult {
  const titleScore = titleSimilarity(fileTitle, candidate.title);
  let score = titleScore;
  let durationDelta: number | null = null;

  if (fileDuration && candidate.duration) {
    durationDelta = Math.abs(fileDuration - candidate.duration);
    const relative = durationDelta / fileDuration;
    if (relative <= 0.02) score += 0.25;
    else if (relative <= 0.05) score += 0.15;
    else if (relative >= 0.25) score -= 0.35;
  }

  return {
    ...candidate,
    score: Math.max(0, Math.min(1, score)),
    titleScore,
    durationDelta,
  };
}

// Search every query variant across movies and scenes, and return the
// candidates best-first. Stops early once a variant produced results, so a
// precise title does not drag in noise from a looser one.
export async function findMatches(
  fileTitle: string,
  fileDuration: number | null
): Promise<ScoredResult[]> {
  const seen = new Map<string, ScoredResult>();

  for (const variant of queryVariants(fileTitle)) {
    for (const type of ["movie", "scene"] as TpdbType[]) {
      let results: TpdbResult[] = [];
      try {
        results = await searchTpdb(variant, type);
      } catch {
        continue; // one failing endpoint must not kill the whole lookup
      }
      for (const r of results.slice(0, 10)) {
        const key = `${r.type}:${r.id}`;
        if (!seen.has(key)) seen.set(key, scoreResult(r, fileTitle, fileDuration));
      }
    }
    if (seen.size > 0) break;
  }

  return [...seen.values()].sort((a, b) => b.score - a.score);
}

// Good enough to apply without a human looking at it. Deliberately strict: a
// wrong auto-match silently mislabels a film, and the manual picker is one
// click away.
export function isConfident(match: ScoredResult): boolean {
  if (match.titleScore < 0.8) return false;
  if (match.durationDelta !== null) {
    // A runtime we can check must agree within 5%.
    return match.score >= 0.9;
  }
  // No runtime to check on either side — demand a near-exact title.
  return match.titleScore >= 0.95;
}
