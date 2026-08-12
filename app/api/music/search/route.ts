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

// Cross-type search (artists + albums + songs) in one call.
export async function GET(request: Request) {
  const resolved = await resolveMusic(request);
  if (!resolved.ok) return resolved.response;
  const { creds } = resolved.ctx;

  const sp = new URL(request.url).searchParams;
  const query = (sp.get("q") || "").trim();
  if (!query) {
    return NextResponse.json({ ok: true, artists: [], albums: [], songs: [] });
  }
  const songCount = Math.min(Math.max(Number(sp.get("songs")) || 40, 0), 200);

  try {
    const res = await subsonicJson<{ searchResult3?: Record<string, unknown> }>(
      creds,
      "search3",
      {
        query,
        artistCount: 12,
        albumCount: 24,
        songCount,
      }
    );
    const r = res.searchResult3 || {};
    return NextResponse.json({
      ok: true,
      artists: asArray(r.artist).map(mapArtist),
      albums: asArray(r.album).map(mapAlbum),
      songs: asArray(r.song).map(mapSong),
    });
  } catch (e) {
    return musicError(e);
  }
}
