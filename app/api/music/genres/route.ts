import { NextResponse } from "next/server";
import { resolveMusic, musicError } from "@/lib/music-api";
import { asArray, subsonicJson } from "@/lib/subsonic";

export const dynamic = "force-dynamic";

// The library's genre index. Subsonic reports the counts as either strings or
// numbers depending on the server, and the name arrives as `value` — neither
// shape should reach the UI.
export async function GET(request: Request) {
  const resolved = await resolveMusic(request);
  if (!resolved.ok) return resolved.response;
  const { creds } = resolved.ctx;

  try {
    const res = await subsonicJson<{ genres?: { genre?: unknown } }>(
      creds,
      "getGenres"
    );
    const genres = asArray(res.genres?.genre)
      .map((raw) => ({
        name: String(raw.value ?? raw.name ?? "").trim(),
        songCount: Number(raw.songCount ?? 0) || 0,
        albumCount: Number(raw.albumCount ?? 0) || 0,
      }))
      .filter((g) => g.name)
      .sort((a, b) => b.songCount - a.songCount);

    return NextResponse.json({ ok: true, genres });
  } catch (e) {
    return musicError(e);
  }
}
