import { NextResponse } from "next/server";
import { resolveMusic, musicError } from "@/lib/music-api";
import { asArray, mapAlbum, mapSong, subsonicJson } from "@/lib/subsonic";

export const dynamic = "force-dynamic";

const SHELF_SIZE = 20;

interface AlbumListResponse {
  albumList2?: { album?: unknown };
}

// The /music landing page: a handful of album shelves plus the user's starred
// songs, fetched in parallel because each is an independent Subsonic call and
// the page is useless until the slowest one lands anyway.
export async function GET(request: Request) {
  const resolved = await resolveMusic(request);
  if (!resolved.ok) return resolved.response;
  const { creds } = resolved.ctx;

  try {
    const shelf = async (type: string) => {
      const res = await subsonicJson<AlbumListResponse>(creds, "getAlbumList2", {
        type,
        size: SHELF_SIZE,
      });
      return asArray(res.albumList2?.album).map(mapAlbum);
    };

    const [newest, frequent, recent, random, starred] = await Promise.all([
      shelf("newest"),
      shelf("frequent"),
      shelf("recent"),
      shelf("random"),
      subsonicJson<{ starred2?: { song?: unknown } }>(creds, "getStarred2").then(
        (r) => asArray(r.starred2?.song).map(mapSong).slice(0, SHELF_SIZE)
      ),
    ]);

    return NextResponse.json({
      ok: true,
      shelves: {
        // "recent" is recently *played*, "newest" is recently *added* — the
        // Subsonic names read the other way round than you would expect.
        newest,
        frequent,
        recent,
        random,
      },
      starredSongs: starred,
    });
  } catch (e) {
    return musicError(e);
  }
}
