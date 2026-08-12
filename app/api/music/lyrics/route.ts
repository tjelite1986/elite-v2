import { NextResponse } from "next/server";
import { resolveMusic, musicError } from "@/lib/music-api";
import { asArray, subsonicJson } from "@/lib/subsonic";

export const dynamic = "force-dynamic";

interface StructuredLyrics {
  lang?: string;
  synced?: boolean;
  line?: unknown;
}

// Lyrics for one song via the OpenSubsonic extension. Navidrome resolves these
// through ND_LYRICSPRIORITY: local .lrc/.ttml sidecars and embedded tags first,
// then the nd-lyrics plugin (LRCLIB). Synced lyrics carry per-line start times
// in milliseconds, which the now-playing view highlights against currentTime.
export async function GET(request: Request) {
  const resolved = await resolveMusic(request);
  if (!resolved.ok) return resolved.response;
  const { creds } = resolved.ctx;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "Bad request" }, { status: 400 });
  }

  try {
    const res = await subsonicJson<{
      lyricsList?: { structuredLyrics?: unknown };
    }>(creds, "getLyricsBySongId", { id });

    const all = asArray(res.lyricsList?.structuredLyrics) as StructuredLyrics[];
    // Prefer a synced version when the song has both.
    const chosen = all.find((l) => l.synced) || all[0];
    if (!chosen) return NextResponse.json({ ok: true, lyrics: null });

    const lines = asArray(chosen.line).map((l) => ({
      start: typeof l.start === "number" ? l.start : null,
      value: typeof l.value === "string" ? l.value : "",
    }));

    return NextResponse.json({
      ok: true,
      lyrics: {
        synced: Boolean(chosen.synced),
        lang: typeof chosen.lang === "string" ? chosen.lang : null,
        lines,
      },
    });
  } catch (e) {
    return musicError(e);
  }
}
