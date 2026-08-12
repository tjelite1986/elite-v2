import { NextResponse } from "next/server";
import { resolveMusic, musicError } from "@/lib/music-api";
import { asArray, mapAlbum, mapSong, subsonicJson } from "@/lib/subsonic";

export const dynamic = "force-dynamic";

// One album with its tracks, in disc/track order.
export async function GET(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;
  const resolved = await resolveMusic(request);
  if (!resolved.ok) return resolved.response;
  const { creds } = resolved.ctx;

  try {
    const res = await subsonicJson<{ album?: Record<string, unknown> }>(
      creds,
      "getAlbum",
      { id }
    );
    if (!res.album) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    const songs = asArray(res.album.song)
      .map(mapSong)
      .sort(
        (a, b) =>
          (a.discNumber ?? 1) - (b.discNumber ?? 1) ||
          (a.track ?? 0) - (b.track ?? 0)
      );
    return NextResponse.json({
      ok: true,
      album: mapAlbum(res.album),
      songs,
    });
  } catch (e) {
    return musicError(e);
  }
}
