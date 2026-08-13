import { NextResponse } from "next/server";
import { resolveMusic, musicError } from "@/lib/music-api";
import { asArray, mapAlbum, mapSong, subsonicJson } from "@/lib/subsonic";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

// One genre: its albums and a page of its songs. Both calls are independent, so
// a slow album list never delays the track list.
export async function GET(
  request: Request,
  props: { params: Promise<{ name: string }> }
) {
  const { name } = await props.params;
  const genre = decodeURIComponent(name);

  const resolved = await resolveMusic(request);
  if (!resolved.ok) return resolved.response;
  const { creds } = resolved.ctx;

  const sp = new URL(request.url).searchParams;
  const offset = Math.max(Number(sp.get("offset")) || 0, 0);

  try {
    const [songs, albums] = await Promise.all([
      subsonicJson<{ songsByGenre?: { song?: unknown } }>(
        creds,
        "getSongsByGenre",
        { genre, count: PAGE_SIZE, offset }
      ).then((r) => asArray(r.songsByGenre?.song).map(mapSong)),
      // Albums are only worth fetching for the first page — the header shelf
      // doesn't paginate.
      offset === 0
        ? subsonicJson<{ albumList2?: { album?: unknown } }>(
            creds,
            "getAlbumList2",
            { type: "byGenre", genre, size: 30 }
          ).then((r) => asArray(r.albumList2?.album).map(mapAlbum))
        : Promise.resolve([]),
    ]);

    return NextResponse.json({
      ok: true,
      genre,
      songs,
      albums,
      hasMore: songs.length === PAGE_SIZE,
    });
  } catch (e) {
    return musicError(e);
  }
}
