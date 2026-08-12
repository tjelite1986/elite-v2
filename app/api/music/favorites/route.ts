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

// Everything this user has starred. Stars live on their own Navidrome account,
// so this is the same set their Navidrome web UI and any Subsonic app shows.
export async function GET(request: Request) {
  const resolved = await resolveMusic(request);
  if (!resolved.ok) return resolved.response;
  const { creds } = resolved.ctx;

  try {
    const res = await subsonicJson<{ starred2?: Record<string, unknown> }>(
      creds,
      "getStarred2"
    );
    const r = res.starred2 || {};
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
