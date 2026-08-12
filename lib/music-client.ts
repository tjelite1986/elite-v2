// Client-side helpers shared by every music component. Types are imported
// type-only from lib/subsonic so none of the server client is bundled.

import type { MusicLibrary, Song } from "./subsonic";

export type { MusicLibrary, Song };
export type { Album, Artist, Playlist } from "./subsonic";

/** Cover art through the Elite proxy — `img-src 'self'` forbids anything else. */
export function coverUrl(
  coverArt: string | null | undefined,
  library: MusicLibrary,
  size = 300
): string | null {
  if (!coverArt) return null;
  return `/api/music/cover/${encodeURIComponent(coverArt)}?library=${library}&size=${size}`;
}

/** Audio through the Elite proxy — likewise, `media-src 'self'`. */
export function streamUrl(songId: string, library: MusicLibrary): string {
  return `/api/music/stream/${encodeURIComponent(songId)}?library=${library}`;
}

/** mm:ss, or h:mm:ss past an hour. Seconds in, as Subsonic reports them. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "--:--";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** "1 h 24 min" for an album/playlist total. */
export function formatTotal(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/** Shared fetch shape for the music API: always JSON, errors surfaced as text. */
export async function musicFetch<T>(
  path: string,
  library: MusicLibrary,
  init?: RequestInit
): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${path}${sep}library=${library}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
  });
  const data = (await res.json().catch(() => null)) as
    | (T & { ok?: boolean; error?: string })
    | null;
  if (!res.ok || !data || data.ok === false) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data as T;
}
