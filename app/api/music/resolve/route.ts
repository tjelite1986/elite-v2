import { NextResponse } from "next/server";
import { resolveMusic, musicError } from "@/lib/music-api";
import {
  SubsonicCreds,
  mapAlbum,
  mapArtist,
  mapPlaylist,
  mapSong,
  subsonicJson,
} from "@/lib/subsonic";

export const dynamic = "force-dynamic";

export type MusicLinkKind = "song" | "album" | "artist" | "playlist";

// Metadata behind a shared /music link, so a link pasted into a chat renders as
// a card instead of a bare URL. Read-only and cheap: one Subsonic call.
export async function GET(request: Request) {
  const resolved = await resolveMusic(request);
  if (!resolved.ok) return resolved.response;
  const { creds } = resolved.ctx;

  const sp = new URL(request.url).searchParams;
  const id = sp.get("id");
  const kind = sp.get("kind");
  if (!id || !isKind(kind)) {
    return NextResponse.json(
      { ok: false, error: "kind and id are required" },
      { status: 400 }
    );
  }

  try {
    return NextResponse.json({ ok: true, item: await describe(creds, kind, id) });
  } catch (e) {
    return musicError(e);
  }
}

function isKind(value: string | null): value is MusicLinkKind {
  return (
    value === "song" || value === "album" || value === "artist" || value === "playlist"
  );
}

interface Described {
  kind: MusicLinkKind;
  id: string;
  title: string;
  subtitle: string | null;
  coverArt: string | null;
  songCount: number | null;
  duration: number | null;
}

async function describe(
  creds: SubsonicCreds,
  kind: MusicLinkKind,
  id: string
): Promise<Described> {
  if (kind === "song") {
    const res = await subsonicJson<{ song?: Record<string, unknown> }>(
      creds,
      "getSong",
      { id }
    );
    const song = mapSong(res.song ?? {});
    return {
      kind,
      id,
      title: song.title,
      subtitle: [song.artist, song.album].filter(Boolean).join(" · ") || null,
      coverArt: song.coverArt,
      songCount: 1,
      duration: song.duration,
    };
  }

  if (kind === "album") {
    const res = await subsonicJson<{ album?: Record<string, unknown> }>(
      creds,
      "getAlbum",
      { id }
    );
    const album = mapAlbum(res.album ?? {});
    return {
      kind,
      id,
      title: album.name,
      subtitle: album.artist,
      coverArt: album.coverArt,
      songCount: album.songCount,
      duration: album.duration,
    };
  }

  if (kind === "artist") {
    const res = await subsonicJson<{ artist?: Record<string, unknown> }>(
      creds,
      "getArtist",
      { id }
    );
    const artist = mapArtist(res.artist ?? {});
    return {
      kind,
      id,
      title: artist.name,
      subtitle: artist.albumCount
        ? `${artist.albumCount} ${artist.albumCount === 1 ? "album" : "albums"}`
        : null,
      coverArt: artist.coverArt,
      songCount: null,
      duration: null,
    };
  }

  const res = await subsonicJson<{ playlist?: Record<string, unknown> }>(
    creds,
    "getPlaylist",
    { id }
  );
  const playlist = mapPlaylist(res.playlist ?? {});
  return {
    kind,
    id,
    title: playlist.name,
    subtitle: playlist.owner ? `Playlist by ${playlist.owner}` : "Playlist",
    coverArt: playlist.coverArt ?? playlist.id,
    songCount: playlist.songCount,
    duration: playlist.duration,
  };
}
