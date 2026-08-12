import { NextResponse } from "next/server";
import { resolveMusic, musicError } from "@/lib/music-api";
import { subsonicJson } from "@/lib/subsonic";

export const dynamic = "force-dynamic";

// Playback reporting. The player calls this twice per track: once at start with
// submission=false ("now playing"), and once past the halfway mark with
// submission=true, which is what bumps the play count and forwards to Last.fm
// (ND_LASTFM_ENABLED is on, each user links their own account in Navidrome).
export async function POST(request: Request) {
  const resolved = await resolveMusic(request);
  if (!resolved.ok) return resolved.response;
  const { creds } = resolved.ctx;

  const body = (await request.json().catch(() => null)) as {
    id?: string;
    submission?: boolean;
  } | null;
  if (!body?.id) {
    return NextResponse.json({ ok: false, error: "Bad request" }, { status: 400 });
  }

  try {
    await subsonicJson(creds, "scrobble", {
      id: body.id,
      submission: body.submission === true,
      time: Date.now(),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    // A failed scrobble must never break playback; report it and move on.
    if (body.submission) return musicError(e);
    return NextResponse.json({ ok: false });
  }
}
