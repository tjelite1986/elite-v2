// Subsonic/OpenSubsonic client for the self-hosted Navidrome instances.
//
// Two libraries live behind this: the household library (`main`) and the
// separate kids instance (`kids`), each its own Navidrome server with its own
// database and user table. They are addressed by id everywhere, so a song id is
// only ever meaningful together with the library it came from.
//
// Auth is Subsonic token auth (`u` + `s` + `t`) — never the password. The
// salt/token pair is minted once per user by lib/navidrome-accounts.ts and
// stored; see that file for why no password is kept on disk.
//
// Nothing here trusts the caller for a base URL: the library id maps to an env
// var, so a client can never point the proxy at an arbitrary host.

export type MusicLibrary = "main" | "kids";

export const MUSIC_LIBRARIES: { id: MusicLibrary; label: string }[] = [
  { id: "main", label: "Music" },
  { id: "kids", label: "Kids" },
];

// Subsonic protocol version we claim, and the client name Navidrome shows in
// its "now playing" / activity views.
const API_VERSION = "1.16.1";
const CLIENT_NAME = "elite-v2";

export interface SubsonicCreds {
  library: MusicLibrary;
  baseUrl: string;
  username: string;
  salt: string;
  token: string;
}

export class SubsonicError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly library: MusicLibrary
  ) {
    super(message);
    this.name = "SubsonicError";
  }
}

export function isMusicLibrary(value: unknown): value is MusicLibrary {
  return value === "main" || value === "kids";
}

export function parseLibrary(value: string | null | undefined): MusicLibrary {
  return isMusicLibrary(value) ? value : "main";
}

/** Base URL of one library's Navidrome, or null when it is not configured. */
export function libraryBaseUrl(library: MusicLibrary): string | null {
  const raw =
    library === "kids"
      ? process.env.NAVIDROME_KIDS_URL
      : process.env.NAVIDROME_URL;
  return raw ? raw.replace(/\/+$/, "") : null;
}

/** Libraries that have a URL set. Being configured is not the same as being up. */
export function configuredLibraries(): MusicLibrary[] {
  return MUSIC_LIBRARIES.map((l) => l.id).filter((id) =>
    Boolean(libraryBaseUrl(id))
  );
}

export function musicConfigured(): boolean {
  return Boolean(libraryBaseUrl("main"));
}

/** Cheap liveness probe — a stopped container should degrade, not throw. */
export async function libraryReachable(library: MusicLibrary): Promise<boolean> {
  const baseUrl = libraryBaseUrl(library);
  if (!baseUrl) return false;
  try {
    const r = await fetch(
      `${baseUrl}/rest/ping?v=${API_VERSION}&c=${CLIENT_NAME}&f=json`,
      { signal: AbortSignal.timeout(4000), cache: "no-store" }
    );
    return r.ok;
  } catch {
    return false;
  }
}

type Params = Record<string, string | number | boolean | undefined | null | string[]>;

function buildQuery(creds: SubsonicCreds, params: Params): string {
  const qs = new URLSearchParams({
    u: creds.username,
    s: creds.salt,
    t: creds.token,
    v: API_VERSION,
    c: CLIENT_NAME,
    f: "json",
  });
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    // Repeated keys are how Subsonic takes lists (playlist songIdToAdd etc.).
    if (Array.isArray(value)) {
      for (const v of value) qs.append(key, String(v));
    } else {
      qs.set(key, String(value));
    }
  }
  return qs.toString();
}

export function subsonicUrl(
  creds: SubsonicCreds,
  method: string,
  params: Params = {}
): string {
  return `${creds.baseUrl}/rest/${method}?${buildQuery(creds, params)}`;
}

/**
 * Call a JSON endpoint. Subsonic reports failures with HTTP 200 and a
 * `status: "failed"` body, so the error code has to come out of the payload.
 */
export async function subsonicJson<T = Record<string, unknown>>(
  creds: SubsonicCreds,
  method: string,
  params: Params = {}
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(subsonicUrl(creds, method, params), {
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    throw new SubsonicError(
      `Navidrome unreachable (${(e as Error).message})`,
      -1,
      creds.library
    );
  }
  if (!res.ok) {
    throw new SubsonicError(`Navidrome HTTP ${res.status}`, -1, creds.library);
  }
  const body = (await res.json().catch(() => null)) as
    | { "subsonic-response"?: Record<string, unknown> }
    | null;
  const payload = body?.["subsonic-response"];
  if (!payload) {
    throw new SubsonicError("Malformed Subsonic response", -1, creds.library);
  }
  if (payload.status === "failed") {
    const err = payload.error as { code?: number; message?: string } | undefined;
    throw new SubsonicError(
      err?.message || "Subsonic request failed",
      err?.code ?? 0,
      creds.library
    );
  }
  return payload as T;
}

/**
 * Call a byte-serving endpoint (stream / getCoverArt / download) and hand back
 * the raw upstream response so a route can stream it through untouched —
 * including a 206 and its Content-Range, which is what makes seeking work.
 */
export async function subsonicRaw(
  creds: SubsonicCreds,
  method: string,
  params: Params = {},
  init: RequestInit = {}
): Promise<Response> {
  return fetch(subsonicUrl(creds, method, params), {
    ...init,
    cache: "no-store",
  });
}

// ---------------------------------------------------------------------------
// App-shaped types. Subsonic's own shapes carry version baggage (`-2` method
// suffixes, ids and counts arriving as either string or number, `starred` as an
// ISO date meaning "yes"), and none of that should reach the UI.
// ---------------------------------------------------------------------------

export interface Song {
  id: string;
  title: string;
  album: string | null;
  albumId: string | null;
  artist: string | null;
  artistId: string | null;
  coverArt: string | null;
  duration: number | null;
  track: number | null;
  discNumber: number | null;
  year: number | null;
  genre: string | null;
  starred: boolean;
  userRating: number | null;
  playCount: number | null;
  suffix: string | null;
  bitRate: number | null;
  size: number | null;
}

export interface Album {
  id: string;
  name: string;
  artist: string | null;
  artistId: string | null;
  coverArt: string | null;
  songCount: number | null;
  duration: number | null;
  year: number | null;
  genre: string | null;
  starred: boolean;
  playCount: number | null;
  created: string | null;
}

export interface Artist {
  id: string;
  name: string;
  albumCount: number | null;
  coverArt: string | null;
  starred: boolean;
}

export interface Playlist {
  id: string;
  name: string;
  comment: string | null;
  owner: string | null;
  public: boolean;
  songCount: number | null;
  duration: number | null;
  created: string | null;
  changed: string | null;
  coverArt: string | null;
}

type Raw = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// `starred` is the date it was starred; its presence is the boolean.
function isStarred(v: unknown): boolean {
  return typeof v === "string" && v !== "";
}

export function mapSong(raw: Raw): Song {
  return {
    id: String(raw.id ?? ""),
    title: str(raw.title) || str(raw.name) || "Unknown",
    album: str(raw.album),
    albumId: str(raw.albumId),
    artist: str(raw.artist),
    artistId: str(raw.artistId),
    // Navidrome serves a song's art under the song id when no explicit
    // coverArt is given.
    coverArt: str(raw.coverArt) || str(raw.id),
    duration: num(raw.duration),
    track: num(raw.track),
    discNumber: num(raw.discNumber),
    year: num(raw.year),
    genre: str(raw.genre),
    starred: isStarred(raw.starred),
    userRating: num(raw.userRating),
    playCount: num(raw.playCount),
    suffix: str(raw.suffix),
    bitRate: num(raw.bitRate),
    size: num(raw.size),
  };
}

export function mapAlbum(raw: Raw): Album {
  return {
    id: String(raw.id ?? ""),
    name: str(raw.name) || str(raw.album) || "Unknown album",
    artist: str(raw.artist),
    artistId: str(raw.artistId),
    coverArt: str(raw.coverArt) || str(raw.id),
    songCount: num(raw.songCount),
    duration: num(raw.duration),
    year: num(raw.year),
    genre: str(raw.genre),
    starred: isStarred(raw.starred),
    playCount: num(raw.playCount),
    created: str(raw.created),
  };
}

export function mapArtist(raw: Raw): Artist {
  return {
    id: String(raw.id ?? ""),
    name: str(raw.name) || "Unknown artist",
    albumCount: num(raw.albumCount),
    coverArt: str(raw.coverArt) || str(raw.id),
    starred: isStarred(raw.starred),
  };
}

export function mapPlaylist(raw: Raw): Playlist {
  return {
    id: String(raw.id ?? ""),
    name: str(raw.name) || "Untitled playlist",
    comment: str(raw.comment),
    owner: str(raw.owner),
    public: raw.public === true || raw.public === "true",
    songCount: num(raw.songCount),
    duration: num(raw.duration),
    created: str(raw.created),
    changed: str(raw.changed),
    coverArt: str(raw.coverArt),
  };
}

/** Subsonic omits empty lists entirely and unwraps single items in some paths. */
export function asArray(value: unknown): Raw[] {
  if (Array.isArray(value)) return value as Raw[];
  if (value && typeof value === "object") return [value as Raw];
  return [];
}
