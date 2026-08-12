import { NextResponse } from "next/server";
import { resolveMusic, musicError } from "@/lib/music-api";
import { asArray, mapAlbum, subsonicJson } from "@/lib/subsonic";

export const dynamic = "force-dynamic";

// Sort modes the browser offers, mapped to Subsonic's getAlbumList2 types.
// Whitelisted rather than passed through: an unknown type makes Navidrome
// return a protocol error instead of an empty page.
const SORTS: Record<string, string> = {
  name: "alphabeticalByName",
  artist: "alphabeticalByArtist",
  newest: "newest",
  recent: "recent",
  frequent: "frequent",
  starred: "starred",
  random: "random",
  year: "byYear",
};

export async function GET(request: Request) {
  const resolved = await resolveMusic(request);
  if (!resolved.ok) return resolved.response;
  const { creds } = resolved.ctx;

  const sp = new URL(request.url).searchParams;
  const type = SORTS[sp.get("sort") || "name"] || SORTS.name;
  const size = Math.min(Math.max(Number(sp.get("size")) || 60, 1), 500);
  const offset = Math.max(Number(sp.get("offset")) || 0, 0);
  const genre = sp.get("genre") || undefined;

  try {
    const res = await subsonicJson<{ albumList2?: { album?: unknown } }>(
      creds,
      "getAlbumList2",
      {
        type: genre ? "byGenre" : type,
        genre,
        size,
        offset,
        // byYear needs a range; ascending over the whole plausible span.
        ...(type === "byYear" ? { fromYear: 0, toYear: 3000 } : {}),
      }
    );
    const albums = asArray(res.albumList2?.album).map(mapAlbum);
    return NextResponse.json({
      ok: true,
      albums,
      offset,
      // Subsonic has no total count here; a short page means the end.
      hasMore: albums.length === size,
    });
  } catch (e) {
    return musicError(e);
  }
}
