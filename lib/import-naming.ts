import { parseHashtags } from "./posts";

// Pure naming layer shared by the folder importer (lib/user-import.ts) and the
// interactive upload routes. Only depends on parseHashtags (regex) so it stays
// cheap to import anywhere on the server.

export interface ParsedImportName {
  title: string;
  hashtags: string[]; // normalized like parseHashtags (lowercase, deduped)
  collection: string | null; // [f_x], or a bare [Collection] (backward compat)
  siteId: number | null; // [id_x] — the app-assigned DB id; present on stored
  // files for re-import dedup, absent on a fresh drop.
}

// Parse an import filename stem into its metadata. Brackets are the delimiter so
// a title may freely contain dots. Grammar:
//   <title> [h_<tag>]... [f_<collection>] [id_<dbid>]
// - title    = everything before the first "[" (trimmed).
// - [h_x]    = a hashtag (repeatable), normalized via parseHashtags.
// - [f_x]    = the collection / on-disk subfolder.
// - [id_x]   = the app-assigned DB id (digits only), used for re-import dedup.
// - a bare [x] with no recognized prefix is a collection — backward compatible
//   with the old "title [Collection].ext" convention.
// No brackets -> the whole stem is the title and the file imports loose.
export function parseImportName(stem: string): ParsedImportName {
  const firstBracket = stem.indexOf("[");
  const title = (firstBracket === -1 ? stem : stem.slice(0, firstBracket)).trim();

  const rawTags: string[] = [];
  let fCollection: string | null = null;
  let bareCollection: string | null = null;
  let siteId: number | null = null;

  const re = /\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stem)) !== null) {
    const tok = m[1].trim();
    if (!tok) continue;
    if (tok.startsWith("h_")) {
      rawTags.push(tok.slice(2));
    } else if (tok.startsWith("f_")) {
      const c = tok.slice(2).trim();
      if (c) fCollection = c;
    } else if (tok.startsWith("id_")) {
      const idStr = tok.slice(3).trim();
      if (/^\d+$/.test(idStr)) siteId = Number(idStr);
    } else if (bareCollection === null) {
      bareCollection = tok; // legacy [Collection]
    }
  }

  // Reuse the caption hashtag rules so filename and caption tags normalize
  // identically (lowercase, [a-z0-9_], deduped).
  const hashtags = parseHashtags(rawTags.map((t) => `#${t}`).join(" "));
  // An explicit [f_x] wins over a bare [Collection].
  const collection = fCollection ?? bareCollection;

  return { title: title || collection || "", hashtags, collection, siteId };
}

// Build the canonical, self-describing stem for a STORED file:
//   "<title> [h_tag]...[f_collection][id_<dbId>]"
// so the stored file is a perfect round-trip artifact — re-dropping it re-parses
// (parseImportName) to the same metadata and its [id_] triggers dedup. Strips
// brackets and path-breaking characters from the title/collection so the grammar
// stays unambiguous, and caps the title so the whole name stays well under the
// 255-byte filename limit.
export function canonicalStem(
  p: ParsedImportName,
  dbId: number,
  fallback = "media"
): string {
  const clean = (s: string) =>
    s.replace(/[/:*?"<>|[\]\x00]+/g, " ").replace(/\s+/g, " ").trim();
  const title = clean(p.title).slice(0, 80) || fallback;
  const tags = p.hashtags.map((t) => `[h_${t}]`).join("");
  const coll = p.collection ? `[f_${clean(p.collection)}]` : "";
  return `${title} ${tags}${coll}[id_${dbId}]`.trim();
}

// Build a canonical stem for an interactive upload from its filename + caption:
// the title comes from the filename (which may itself use the [bracket] scheme),
// and hashtags merge the filename's [h_] tokens with the caption's #tags.
export function uploadStem(
  filename: string,
  caption: string | null,
  dbId: number,
  fallback = "media"
): string {
  const stem = filename.replace(/\.[^./\\]+$/, "");
  const parsed = parseImportName(stem);
  const hashtags = Array.from(
    new Set([...parsed.hashtags, ...parseHashtags(caption ?? null)])
  );
  return canonicalStem({ ...parsed, hashtags }, dbId, fallback);
}
