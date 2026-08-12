import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isMusicLibrary } from "@/lib/subsonic";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GRABBIT = process.env.GRABBIT_URL || "http://grabbit:3000";
const GRABBIT_HEADERS = { "x-grabbit-token": process.env.GRABBIT_INTERNAL_TOKEN || "" };

// Audio formats grabbit accepts (its AUDIO_FORMATS list). Whitelisted here so a
// typo becomes a 400 rather than grabbit silently substituting a default.
const AUDIO_FORMATS = [
  "best",
  "m4a",
  "mp3",
  "opus",
  "flac",
  "wav",
  "vorbis",
  "aac",
  "alac",
];
// grabbit maps these to yt-dlp --audio-quality; "" means leave its default.
const BITRATES = ["", "320", "256", "192", "160", "128", "96"];
const RELEASE_TYPES = ["album", "single", "ep"];
const SPONSOR_MODES = ["", "remove", "mark"];

// Queue a download straight into the Navidrome library via Grabbit, which does
// the tagging and library sorting (dest=navidrome is jobs-API only for exactly
// that reason). The file appears in /music after Navidrome's next scan; the
// scan interval is hourly, and the Navidrome UI can force one.
//
// Every option grabbit's own Navidrome save offers is passed through — target
// library, tags, audio format and bitrate, SponsorBlock, extra yt-dlp flags and
// a scheduled start. The ones grabbit rejects for this destination (cutting,
// chapter splitting, video container) are deliberately absent.
//
// Admin only: this writes into the shared music library, not a personal folder.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    url?: string;
    library?: string;
    title?: string;
    artists?: string;
    album?: string;
    release?: string;
    date?: string;
    genres?: string;
    afmt?: string;
    aq?: string;
    sponsor?: string;
    xargs?: string;
    at?: number;
  } | null;

  const url = (body?.url || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    return NextResponse.json({ ok: false, error: "Invalid URL" }, { status: 400 });
  }

  const qs = new URLSearchParams({
    url,
    dest: "navidrome",
    lib: isMusicLibrary(body?.library) ? body.library : "main",
    device: "0",
  });

  // Free-text tag fields. grabbit tests for the parameter being present rather
  // than truthy on some of these, so only send what was actually filled in.
  for (const key of ["title", "artists", "album", "date", "genres"] as const) {
    const value = body?.[key];
    if (typeof value === "string" && value.trim()) qs.set(key, value.trim());
  }

  // A single is filed under its own name and takes no album, which is grabbit's
  // rule — send the release type and let it decide, but don't contradict it.
  const release = body?.release;
  if (typeof release === "string" && RELEASE_TYPES.includes(release)) {
    if (release !== "album") qs.set("release", release);
    if (release === "single") qs.delete("album");
  }

  const afmt = body?.afmt;
  if (typeof afmt === "string" && AUDIO_FORMATS.includes(afmt)) qs.set("afmt", afmt);

  const aq = body?.aq;
  if (typeof aq === "string" && aq && BITRATES.includes(aq)) qs.set("aq", aq);

  const sponsor = body?.sponsor;
  if (typeof sponsor === "string" && sponsor && SPONSOR_MODES.includes(sponsor)) {
    qs.set("sponsor", sponsor);
  }

  const xargs = body?.xargs;
  if (typeof xargs === "string" && xargs.trim()) qs.set("xargs", xargs.trim().slice(0, 500));

  // Scheduled start, epoch ms. A time in the past would run immediately anyway;
  // rejecting it here keeps "scheduled" honest in the UI.
  const at = body?.at;
  if (typeof at === "number" && Number.isFinite(at) && at > Date.now()) {
    qs.set("at", String(Math.round(at)));
  }

  try {
    const r = await fetch(`${GRABBIT}/api/jobs/start?${qs.toString()}`, {
      headers: GRABBIT_HEADERS,
    });
    const data = await r.json().catch(() => ({ ok: false, error: "Download failed" }));
    return NextResponse.json(data);
  } catch {
    // 200 with the failure in the body: Cloudflare replaces a 5xx body with its
    // own HTML page, which the client would fail to parse as JSON.
    return NextResponse.json({ ok: false, error: "Grabber unreachable" });
  }
}
