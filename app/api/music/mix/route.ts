import { NextResponse } from "next/server";
import { resolveMusic, musicError } from "@/lib/music-api";
import {
  Song,
  SubsonicCreds,
  SubsonicError,
  asArray,
  mapSong,
  subsonicJson,
} from "@/lib/subsonic";

export const dynamic = "force-dynamic";

const MIX_SIZE = 60;
// Below this, the similar-song agent effectively gave nothing back and the mix
// is padded from the same genre instead of handing over a two-track "radio".
const MIN_USEFUL = 8;

/**
 * A radio queue seeded by one song, album or artist.
 *
 * `getSimilarSongs` is only as good as Navidrome's agents — with no Last.fm key
 * it can return a handful of tracks or nothing at all. So the result is topped
 * up from the seed's genre, and finally from random songs, which means the
 * button always produces something playable.
 */
export async function GET(request: Request) {
  const resolved = await resolveMusic(request);
  if (!resolved.ok) return resolved.response;
  const { creds } = resolved.ctx;

  const sp = new URL(request.url).searchParams;
  const id = sp.get("id");
  const type = sp.get("type") === "artist" ? "artist" : sp.get("type") === "album" ? "album" : "song";
  if (!id) {
    return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
  }

  try {
    const seed = type === "song" ? await getSeedSong(creds, id) : null;
    const similar = await similarSongs(creds, id);

    const seen = new Set<string>();
    const mix: Song[] = [];
    const push = (song: Song) => {
      if (!song.id || seen.has(song.id)) return;
      seen.add(song.id);
      mix.push(song);
    };

    // The seed itself opens the radio — starting a mix from a track you just
    // tapped should play that track.
    if (seed) push(seed);
    for (const song of similar) push(song);

    if (mix.length < MIN_USEFUL) {
      const genre = seed?.genre ?? similar.find((s) => s.genre)?.genre ?? null;
      for (const song of await randomSongs(creds, genre)) push(song);
      // Still nothing (an unlabelled library): fall back to anything at all.
      if (mix.length < MIN_USEFUL && genre) {
        for (const song of await randomSongs(creds, null)) push(song);
      }
    }

    return NextResponse.json({
      ok: true,
      songs: mix.slice(0, MIX_SIZE),
      seed: seed ? { title: seed.title, artist: seed.artist } : null,
    });
  } catch (e) {
    return musicError(e);
  }
}

async function getSeedSong(
  creds: SubsonicCreds,
  id: string
): Promise<Song | null> {
  try {
    const res = await subsonicJson<{ song?: unknown }>(creds, "getSong", { id });
    return res.song ? mapSong(res.song as Record<string, unknown>) : null;
  } catch (e) {
    // A missing seed is not fatal — the radio can still be built from the id.
    if (e instanceof SubsonicError && e.code === 70) return null;
    throw e;
  }
}

async function similarSongs(
  creds: SubsonicCreds,
  id: string
): Promise<Song[]> {
  try {
    const res = await subsonicJson<{ similarSongs?: { song?: unknown } }>(
      creds,
      "getSimilarSongs",
      { id, count: MIX_SIZE }
    );
    return asArray(res.similarSongs?.song).map(mapSong);
  } catch (e) {
    // Servers without the endpoint answer code 30/70 rather than 404; the
    // genre fallback below covers it.
    if (e instanceof SubsonicError) return [];
    throw e;
  }
}

async function randomSongs(
  creds: SubsonicCreds,
  genre: string | null
): Promise<Song[]> {
  const res = await subsonicJson<{ randomSongs?: { song?: unknown } }>(
    creds,
    "getRandomSongs",
    { size: MIX_SIZE, genre: genre || undefined }
  );
  return asArray(res.randomSongs?.song).map(mapSong);
}
