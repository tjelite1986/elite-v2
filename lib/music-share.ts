// Shared /music links: how one is built, and how a link found in a chat message
// is recognised again so it can be rendered as a card instead of a bare URL.
//
// A shared link is an ordinary in-app URL — no token, no separate share table.
// Whoever opens it needs an Elite session and their own Navidrome account, which
// is exactly the access they already had.

import type { MusicLibrary } from "./subsonic";
import { isMusicLibrary } from "./subsonic";

export type MusicLinkKind = "song" | "album" | "artist" | "playlist";

export interface MusicLink {
  kind: MusicLinkKind;
  id: string;
  library: MusicLibrary;
}

// A song has no page of its own — it opens inside its album — so a shared song
// carries the id in a query parameter on the album route it belongs to.
const PATHS: Record<Exclude<MusicLinkKind, "song">, string> = {
  album: "/music/albums",
  artist: "/music/artists",
  playlist: "/music/playlists",
};

/** The in-app path for a music entity, without an origin. */
export function musicPath(link: MusicLink, albumId?: string | null): string {
  const query = `?library=${link.library}`;
  if (link.kind === "song") {
    return albumId
      ? `${PATHS.album}/${encodeURIComponent(albumId)}${query}&track=${encodeURIComponent(link.id)}`
      : `/music${query}&track=${encodeURIComponent(link.id)}`;
  }
  return `${PATHS[link.kind]}/${encodeURIComponent(link.id)}${query}`;
}

/** The absolute URL to paste into a message. Client-side only. */
export function musicShareUrl(link: MusicLink, albumId?: string | null): string {
  const path = musicPath(link, albumId);
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}

/**
 * Recognise one of our own music links. Returns null for anything else —
 * including music links from another host, which are somebody else's library.
 */
export function parseMusicLink(url: string): MusicLink | null {
  let parsed: URL;
  try {
    parsed = new URL(
      url,
      typeof window === "undefined" ? "http://localhost" : window.location.origin
    );
  } catch {
    return null;
  }
  if (typeof window !== "undefined" && parsed.origin !== window.location.origin) {
    return null;
  }

  const library = parsed.searchParams.get("library");
  const lib: MusicLibrary = isMusicLibrary(library) ? library : "main";

  const track = parsed.searchParams.get("track");
  if (track) return { kind: "song", id: track, library: lib };

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments[0] !== "music" || segments.length < 3) return null;
  const [, section, rawId] = segments;
  const id = decodeURIComponent(rawId);
  if (!id) return null;
  if (section === "albums") return { kind: "album", id, library: lib };
  if (section === "artists") return { kind: "artist", id, library: lib };
  if (section === "playlists") return { kind: "playlist", id, library: lib };
  return null;
}
