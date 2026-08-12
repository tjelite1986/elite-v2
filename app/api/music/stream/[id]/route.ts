import { NextResponse } from "next/server";
import { resolveMusic, musicError } from "@/lib/music-api";
import { subsonicRaw } from "@/lib/subsonic";

export const dynamic = "force-dynamic";

// Audio proxy. The app's CSP is `media-src 'self'`, so the browser can never
// fetch from navidrome:4533 itself — and it shouldn't, since that would mean
// handing Subsonic credentials to the client. Every byte goes through here.
//
// The incoming Range header is forwarded untouched and the upstream 206 and its
// Content-Range are mirrored back, so the <audio> element can seek without
// Elite ever buffering a whole track.
export async function GET(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;
  const resolved = await resolveMusic(request);
  if (!resolved.ok) return resolved.response;
  const { creds } = resolved.ctx;

  const sp = new URL(request.url).searchParams;
  // Optional transcoding, done by Navidrome (it has the ffmpeg build): the
  // player asks for a capped bitrate on a metered connection. Absent = original.
  const maxBitRate = Number(sp.get("maxBitRate"));
  const format = sp.get("format");

  const range = request.headers.get("range");

  try {
    const upstream = await subsonicRaw(
      creds,
      "stream",
      {
        id,
        maxBitRate:
          Number.isFinite(maxBitRate) && maxBitRate > 0 ? maxBitRate : undefined,
        format: format === "opus" || format === "mp3" || format === "raw"
          ? format
          : undefined,
      },
      { headers: range ? { range } : {} }
    );

    if (!upstream.ok && upstream.status !== 206) {
      return NextResponse.json(
        { ok: false, error: `Stream failed (${upstream.status})` },
        { status: upstream.status === 404 ? 404 : 502 }
      );
    }

    const headers = new Headers();
    for (const key of [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
    ]) {
      const value = upstream.headers.get(key);
      if (value) headers.set(key, value);
    }
    if (!headers.has("accept-ranges")) headers.set("accept-ranges", "bytes");
    // Per-user credentials are baked into the upstream request, so this is a
    // private response — but it is byte-identical per song, so let the browser
    // reuse it while the tab lives (replaying a track shouldn't re-download it).
    headers.set("Cache-Control", "private, max-age=3600");
    headers.set("X-Content-Type-Options", "nosniff");

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (e) {
    return musicError(e);
  }
}
