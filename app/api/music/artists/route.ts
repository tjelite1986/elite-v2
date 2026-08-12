import { NextResponse } from "next/server";
import { resolveMusic, musicError } from "@/lib/music-api";
import { asArray, mapArtist, subsonicJson } from "@/lib/subsonic";

export const dynamic = "force-dynamic";

// The full artist index, flattened. Subsonic groups artists under initial-letter
// buckets; the UI wants one list it can filter, and 500-odd artists is a single
// cheap call, so there is no paging here.
export async function GET(request: Request) {
  const resolved = await resolveMusic(request);
  if (!resolved.ok) return resolved.response;
  const { creds } = resolved.ctx;

  try {
    const res = await subsonicJson<{
      artists?: { index?: unknown };
    }>(creds, "getArtists");
    const artists = asArray(res.artists?.index)
      .flatMap((bucket) => asArray(bucket.artist))
      .map(mapArtist);
    return NextResponse.json({ ok: true, artists });
  } catch (e) {
    return musicError(e);
  }
}
