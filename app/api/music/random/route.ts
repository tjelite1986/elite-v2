import { NextResponse } from "next/server";
import { resolveMusic, musicError } from "@/lib/music-api";
import { asArray, mapSong, subsonicJson } from "@/lib/subsonic";

export const dynamic = "force-dynamic";

// "Shuffle the whole library" — the server picks the sample, so the client never
// has to hold 1000+ song ids to shuffle them itself.
export async function GET(request: Request) {
  const resolved = await resolveMusic(request);
  if (!resolved.ok) return resolved.response;
  const { creds } = resolved.ctx;

  const sp = new URL(request.url).searchParams;
  const size = Math.min(Math.max(Number(sp.get("size")) || 50, 1), 200);
  const genre = sp.get("genre") || undefined;

  try {
    const res = await subsonicJson<{ randomSongs?: { song?: unknown } }>(
      creds,
      "getRandomSongs",
      { size, genre }
    );
    return NextResponse.json({
      ok: true,
      songs: asArray(res.randomSongs?.song).map(mapSong),
    });
  } catch (e) {
    return musicError(e);
  }
}
