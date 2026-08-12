import { NextResponse } from "next/server";
import { resolveMusic, musicError } from "@/lib/music-api";
import { subsonicJson } from "@/lib/subsonic";

export const dynamic = "force-dynamic";

// Star / unstar a song, album or artist. Each type has its own parameter name
// in Subsonic — passing an album id as `id` stars nothing.
const PARAM: Record<string, "id" | "albumId" | "artistId"> = {
  song: "id",
  album: "albumId",
  artist: "artistId",
};

export async function POST(request: Request) {
  const resolved = await resolveMusic(request);
  if (!resolved.ok) return resolved.response;
  const { creds } = resolved.ctx;

  const body = (await request.json().catch(() => null)) as {
    id?: string;
    type?: string;
    starred?: boolean;
  } | null;
  const id = body?.id;
  const param = PARAM[body?.type || "song"];
  if (!id || !param) {
    return NextResponse.json({ ok: false, error: "Bad request" }, { status: 400 });
  }

  try {
    await subsonicJson(creds, body?.starred ? "star" : "unstar", { [param]: id });
    return NextResponse.json({ ok: true, starred: Boolean(body?.starred) });
  } catch (e) {
    return musicError(e);
  }
}
