import { NextResponse } from "next/server";
import { resolveMusic, musicError } from "@/lib/music-api";
import {
  asArray,
  mapAlbum,
  mapArtist,
  mapSong,
  subsonicJson,
} from "@/lib/subsonic";

export const dynamic = "force-dynamic";

// One artist: their albums, their most-played tracks, and the Last.fm biography
// Navidrome caches (ND_LASTFM_ENABLED is on). The bio and top songs are
// best-effort — an artist the metadata agents have never heard of should still
// render their albums.
export async function GET(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;
  const resolved = await resolveMusic(request);
  if (!resolved.ok) return resolved.response;
  const { creds } = resolved.ctx;

  try {
    const res = await subsonicJson<{ artist?: Record<string, unknown> }>(
      creds,
      "getArtist",
      { id }
    );
    if (!res.artist) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    const artist = mapArtist(res.artist);
    const albums = asArray(res.artist.album)
      .map(mapAlbum)
      .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));

    const [info, topSongs] = await Promise.all([
      subsonicJson<{ artistInfo2?: Record<string, unknown> }>(
        creds,
        "getArtistInfo2",
        { id }
      )
        .then((r) => r.artistInfo2 ?? null)
        .catch(() => null),
      subsonicJson<{ topSongs?: { song?: unknown } }>(creds, "getTopSongs", {
        artist: artist.name,
        count: 10,
      })
        .then((r) => asArray(r.topSongs?.song).map(mapSong))
        .catch(() => []),
    ]);

    return NextResponse.json({
      ok: true,
      artist,
      albums,
      topSongs,
      biography:
        typeof info?.biography === "string" && info.biography
          ? // Last.fm bios end with an anchor back to their site; the app's CSP
            // and link handling make that markup useless here.
            info.biography.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, "").trim()
          : null,
      similar: asArray(info?.similarArtist).map(mapArtist),
    });
  } catch (e) {
    return musicError(e);
  }
}
