import { NextResponse } from "next/server";
import { resolveMusic, musicError } from "@/lib/music-api";
import { mapSong, subsonicJson } from "@/lib/subsonic";

export const dynamic = "force-dynamic";

// One track's full detail, for the info sheet: the mapped song plus the
// technical fields the list views drop (container, sample rate, path, plays).
export async function GET(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;
  const resolved = await resolveMusic(request);
  if (!resolved.ok) return resolved.response;
  const { creds } = resolved.ctx;

  try {
    const res = await subsonicJson<{ song?: Record<string, unknown> }>(
      creds,
      "getSong",
      { id }
    );
    const raw = res.song;
    if (!raw) {
      return NextResponse.json(
        { ok: false, error: "Track not found" },
        { status: 404 }
      );
    }

    const numeric = (key: string): number | null => {
      const v = raw[key];
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
      return Number.isFinite(n) ? n : null;
    };
    const text = (key: string): string | null => {
      const v = raw[key];
      return typeof v === "string" && v !== "" ? v : null;
    };

    return NextResponse.json({
      ok: true,
      song: mapSong(raw),
      detail: {
        contentType: text("contentType"),
        samplingRate: numeric("samplingRate"),
        bitDepth: numeric("bitDepth"),
        channelCount: numeric("channelCount"),
        bpm: numeric("bpm"),
        created: text("created"),
        // Navidrome only exposes the on-disk path to admins; for everyone else
        // it is simply absent, which the sheet renders as a missing row.
        path: text("path"),
        comment: text("comment"),
        musicBrainzId: text("musicBrainzId"),
      },
    });
  } catch (e) {
    return musicError(e);
  }
}
