import { NextResponse } from "next/server";
import { resolveMusic, musicError } from "@/lib/music-api";
import { asArray, mapPlaylist, subsonicJson } from "@/lib/subsonic";

export const dynamic = "force-dynamic";

// Playlists belong to the caller's own Navidrome account, so this is their own
// list plus anything shared with them — the same view the Navidrome UI gives.
export async function GET(request: Request) {
  const resolved = await resolveMusic(request);
  if (!resolved.ok) return resolved.response;
  const { creds } = resolved.ctx;

  try {
    const res = await subsonicJson<{ playlists?: { playlist?: unknown } }>(
      creds,
      "getPlaylists"
    );
    const playlists = asArray(res.playlists?.playlist)
      .map(mapPlaylist)
      .sort((a, b) => (b.changed || "").localeCompare(a.changed || ""));
    return NextResponse.json({ ok: true, playlists });
  } catch (e) {
    return musicError(e);
  }
}

// Create a playlist, optionally seeded with songs ("save queue as playlist",
// "add this album to a new playlist").
export async function POST(request: Request) {
  const resolved = await resolveMusic(request);
  if (!resolved.ok) return resolved.response;
  const { creds } = resolved.ctx;

  const body = (await request.json().catch(() => null)) as {
    name?: string;
    songIds?: string[];
  } | null;
  const name = (body?.name || "").trim();
  if (!name) {
    return NextResponse.json(
      { ok: false, error: "A playlist needs a name" },
      { status: 400 }
    );
  }
  const songIds = Array.isArray(body?.songIds)
    ? body.songIds.filter((s) => typeof s === "string" && s)
    : [];

  try {
    const res = await subsonicJson<{ playlist?: Record<string, unknown> }>(
      creds,
      "createPlaylist",
      { name, songId: songIds }
    );
    return NextResponse.json({
      ok: true,
      // Older Subsonic servers answer createPlaylist with an empty body; the
      // caller refetches the list in that case.
      playlist: res.playlist ? mapPlaylist(res.playlist) : null,
    });
  } catch (e) {
    return musicError(e);
  }
}
