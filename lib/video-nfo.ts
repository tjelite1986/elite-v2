import fs from "node:fs";
import path from "node:path";

// Whisparr / Stash / Jellyfin lay a scene out as its own folder holding the
// video, a .nfo sidecar and artwork. The sidecar already carries everything a
// metadata lookup would go and ask a third party for — including the TPDB id —
// so reading it beats searching: it is offline, instant and exactly right.
//
// The parser is deliberately small: NFO files are machine-written, flat XML, so
// tag extraction is enough and the app avoids an XML dependency. Anything
// unparsable simply yields null and the caller falls back to TPDB search.

export interface NfoData {
  title: string | null;
  plot: string | null;
  date: string | null; // ISO yyyy-mm-dd
  studio: string | null;
  performers: string[];
  tags: string[];
  tpdbId: string | null;
  tpdbType: "movie" | "scene" | null;
  sourceUrl: string | null;
  runtimeSeconds: number | null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

function all(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const value = decodeEntities(m[1]).trim();
    if (value) out.push(value);
  }
  return out;
}

function first(xml: string, ...tags: string[]): string | null {
  for (const tag of tags) {
    const value = all(xml, tag)[0];
    if (value) return value;
  }
  return null;
}

// <actor><name>X</name>…</actor> — pull the name out of each actor block only,
// so a <name> somewhere else in the file cannot leak in.
function actorNames(xml: string): string[] {
  return all(xml, "actor")
    .map((block) => first(block, "name"))
    .filter((n): n is string => Boolean(n));
}

function isoDate(value: string | null): string | null {
  if (!value) return null;
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // A bare <year>2019</year> is still worth keeping as a January date.
  const y = /^(\d{4})$/.exec(value.trim());
  return y ? `${y[1]}-01-01` : null;
}

export function parseNfo(xml: string): NfoData {
  const title = first(xml, "title");
  const plot = first(xml, "plot", "outline");
  const date =
    isoDate(first(xml, "premiered", "releasedate", "aired")) ??
    isoDate(first(xml, "year"));

  // Two <studio> tags are normal: the specific site first, the network second.
  // The site is the useful one, so the first non-empty wins.
  const studio = all(xml, "studio")[0] ?? first(xml, "showtitle");

  // <genre> and <tag> largely duplicate each other; merge and de-duplicate.
  const tags = [...new Set([...all(xml, "genre"), ...all(xml, "tag")])];

  // <theporndbid>scenes/224654</theporndbid> carries the TYPE, while
  // <theporndbguid> carries the uuid the API actually addresses records by —
  // so the type comes from one tag and the id preferably from the other.
  let tpdbId: string | null = null;
  let tpdbType: "movie" | "scene" | null = null;
  const raw = first(xml, "theporndbid", "tpdbid");
  if (raw) {
    const m = /^(scenes|movies|scene|movie)?\/?([\w-]+)$/i.exec(raw.trim());
    if (m) {
      tpdbId = m[2];
      tpdbType = m[1]?.toLowerCase().startsWith("movie") ? "movie" : "scene";
    }
  }
  const guid = first(xml, "theporndbguid");
  if (guid && /^[0-9a-f-]{20,}$/i.test(guid.trim())) tpdbId = guid.trim();

  // Prefer the exact seconds from the stream details over the rounded minutes.
  const seconds = first(xml, "durationinseconds");
  const minutes = first(xml, "runtime");
  const runtimeSeconds = seconds
    ? Number(seconds) || null
    : minutes
      ? (Number(minutes) || 0) * 60 || null
      : null;

  return {
    title,
    plot,
    date,
    studio,
    performers: actorNames(xml),
    tags,
    tpdbId,
    tpdbType,
    sourceUrl: first(xml, "sourceid") ?? null,
    runtimeSeconds,
  };
}

// Later files only fill gaps left by earlier ones, so the more specific sidecar
// wins while the general one still contributes what it alone knows.
function mergeNfo(parts: NfoData[]): NfoData | null {
  if (!parts.length) return null;
  const merged = { ...parts[0] };
  for (const part of parts.slice(1)) {
    merged.title ??= part.title;
    merged.plot ??= part.plot;
    merged.date ??= part.date;
    merged.studio ??= part.studio;
    merged.tpdbId ??= part.tpdbId;
    merged.tpdbType ??= part.tpdbType;
    merged.sourceUrl ??= part.sourceUrl;
    merged.runtimeSeconds ??= part.runtimeSeconds;
    if (!merged.performers.length) merged.performers = part.performers;
    if (!merged.tags.length) merged.tags = part.tags;
  }
  return merged;
}

// Sidecars for a video, most specific first. The per-scene folder layout writes
// BOTH "<name>.nfo" and movie.nfo, and they do not carry the same things — the
// scene file has the TPDB guid and source URL, while only movie.nfo lists the
// performers. Reading just one silently drops half the metadata.
export function findNfoFiles(videoPath: string): string[] {
  const dir = path.dirname(videoPath);
  const stem = path.basename(videoPath, path.extname(videoPath));
  const found: string[] = [];
  for (const candidate of [
    path.join(dir, `${stem}.nfo`),
    path.join(dir, "movie.nfo"),
  ]) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).size > 0) {
        found.push(candidate);
      }
    } catch {
      /* unreadable — try the next */
    }
  }
  return found;
}

export function readNfo(videoPath: string): NfoData | null {
  const parts: NfoData[] = [];
  for (const file of findNfoFiles(videoPath)) {
    try {
      // The files are UTF-8 with a BOM; strip it so the first tag parses.
      const xml = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
      parts.push(parseNfo(xml));
    } catch {
      /* skip an unreadable sidecar */
    }
  }
  const data = mergeNfo(parts);
  return data && (data.title || data.tpdbId) ? data : null;
}

// Cover art shipped next to the video. The paths inside <art> point at the
// machine that wrote the NFO, so they are useless here — the files beside the
// video are what matter.
export function findLocalPoster(videoPath: string): string | null {
  const dir = path.dirname(videoPath);
  const stem = path.basename(videoPath, path.extname(videoPath));
  // Landscape art first — the library grid is 16:9, so a portrait poster would
  // be centre-cropped into an unrecognisable strip.
  const candidates = [
    `${stem}-background.png`,
    `${stem}-background.jpg`,
    `${stem}-fanart.jpg`,
    `${stem}-thumb.jpg`,
    "fanart.jpg",
    "backdrop.jpg",
    `${stem}-poster.png`,
    `${stem}-poster.jpg`,
    "poster.png",
    "poster.jpg",
    "folder.jpg",
    "cover.jpg",
  ];
  for (const name of candidates) {
    const file = path.join(dir, name);
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;
    } catch {
      /* try the next */
    }
  }
  return null;
}
