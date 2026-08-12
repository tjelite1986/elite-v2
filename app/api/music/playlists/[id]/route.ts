import { NextResponse } from "next/server";
import { resolveMusic, musicError } from "@/lib/music-api";
import { asArray, mapPlaylist, mapSong, subsonicJson } from "@/lib/subsonic";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;
  const resolved = await resolveMusic(request);
  if (!resolved.ok) return resolved.response;
  const { creds } = resolved.ctx;

  try {
    const res = await subsonicJson<{ playlist?: Record<string, unknown> }>(
      creds,
      "getPlaylist",
      { id }
    );
    if (!res.playlist) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    // Playlist order is the stored order — never re-sorted, unlike an album.
    return NextResponse.json({
      ok: true,
      playlist: mapPlaylist(res.playlist),
      songs: asArray(res.playlist.entry).map(mapSong),
    });
  } catch (e) {
    return musicError(e);
  }
}

interface PatchBody {
  name?: string;
  comment?: string;
  public?: boolean;
  add?: string[];      // song ids appended to the end
  remove?: number[];   // indices into the current track list
  order?: string[];    // full ordered id list, replacing the contents
}

// Edit a playlist. Renaming/adding/removing goes through updatePlaylist;
// reordering does not exist in that call, so a reorder replaces the contents
// via createPlaylist with an existing playlistId (which Subsonic defines as an
// update, and Navidrome implements as a full replace).
export async function PATCH(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;
  const resolved = await resolveMusic(request);
  if (!resolved.ok) return resolved.response;
  const { creds } = resolved.ctx;

  const body = (await request.json().catch(() => null)) as PatchBody | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "Bad request" }, { status: 400 });
  }

  try {
    if (Array.isArray(body.order)) {
      const songId = body.order.filter((s) => typeof s === "string" && s);
      await subsonicJson(creds, "createPlaylist", { playlistId: id, songId });
    }

    const update: Record<string, string | number | boolean | string[] | number[]> = {};
    if (typeof body.name === "string" && body.name.trim()) {
      update.name = body.name.trim();
    }
    if (typeof body.comment === "string") update.comment = body.comment;
    if (typeof body.public === "boolean") update.public = body.public;
    if (Array.isArray(body.add) && body.add.length) {
      update.songIdToAdd = body.add.filter((s) => typeof s === "string" && s);
    }
    if (Array.isArray(body.remove) && body.remove.length) {
      // Remove from the back so earlier indices stay valid while the server
      // applies them in order.
      update.songIndexToRemove = body.remove
        .filter((n) => Number.isInteger(n) && n >= 0)
        .sort((a, b) => b - a);
    }
    if (Object.keys(update).length) {
      await subsonicJson(creds, "updatePlaylist", { playlistId: id, ...update });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return musicError(e);
  }
}

export async function DELETE(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;
  const resolved = await resolveMusic(request);
  if (!resolved.ok) return resolved.response;
  const { creds } = resolved.ctx;

  try {
    await subsonicJson(creds, "deletePlaylist", { id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return musicError(e);
  }
}
