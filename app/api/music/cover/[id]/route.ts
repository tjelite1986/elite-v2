import { NextResponse } from "next/server";
import { resolveMusic, musicError } from "@/lib/music-api";
import { subsonicRaw } from "@/lib/subsonic";

export const dynamic = "force-dynamic";

// Cover-art proxy — `img-src 'self'` means an <img> can never point at
// Navidrome directly (same rule that put external images behind
// /api/image-proxy). Navidrome resizes server-side, so `size` is passed along
// and a grid of 60 covers doesn't pull 60 full-resolution JPEGs.
export async function GET(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;
  const resolved = await resolveMusic(request);
  if (!resolved.ok) return resolved.response;
  const { creds } = resolved.ctx;

  const requested = Number(new URL(request.url).searchParams.get("size"));
  const size =
    Number.isFinite(requested) && requested >= 32 && requested <= 1200
      ? Math.round(requested)
      : undefined;

  try {
    const upstream = await subsonicRaw(creds, "getCoverArt", { id, size });
    if (!upstream.ok) {
      // A song with no artwork is normal, not an error — the UI draws a
      // placeholder on 404.
      return new NextResponse(null, { status: 404 });
    }
    const headers = new Headers();
    const type = upstream.headers.get("content-type");
    if (type) headers.set("content-type", type);
    const length = upstream.headers.get("content-length");
    if (length) headers.set("content-length", length);
    // Cover art for a given id+size never changes; Navidrome regenerates under
    // a new id when the file's artwork does.
    headers.set("Cache-Control", "private, max-age=86400, immutable");
    headers.set("X-Content-Type-Options", "nosniff");
    return new NextResponse(upstream.body, { status: 200, headers });
  } catch (e) {
    return musicError(e);
  }
}
