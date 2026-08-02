import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { scanAllVideos, scanVideoChannel } from "@/lib/videos";
import { parseVideoChannel } from "@/lib/videos-storage";
import { startMetadataRun } from "@/lib/video-metadata";
import type { ScanResult } from "@/lib/videos";

// New 18+ files carry their own sidecar metadata, but performer biographies and
// portraits come from ThePornDB — which only the metadata pass fetches. Without
// this a fresh drop shows unknown performers until the next hourly run.
// Fire-and-forget: it declines on its own if a run is already going.
function matchNewAdultVideos(results: ScanResult[]) {
  if (results.some((r) => r.channel === "adults" && r.added > 0)) {
    startMetadataRun();
  }
}

export const dynamic = "force-dynamic";
// Probing + poster/storyboard generation is ffmpeg-bound and a first scan of a
// large library can take a while.
export const maxDuration = 3600;

// Rescan the on-disk video library. Authorized either by an admin session (the
// button in the UI) or by the scheduler presenting IMPORT_CRON_SECRET, so the
// same code path serves both. ?channel=main|adults scopes it; omitted scans all.
export async function POST(request: Request) {
  const session = await getSession();
  const secret = process.env.IMPORT_CRON_SECRET;
  const isCron = Boolean(secret) && request.headers.get("x-import-secret") === secret;
  const isAdmin = session?.role === "admin";
  if (!isAdmin && !isCron) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const param = new URL(request.url).searchParams.get("channel");
  if (param) {
    const channel = parseVideoChannel(param);
    if (!channel) {
      return NextResponse.json({ error: "Unknown channel" }, { status: 400 });
    }
    const results = [await scanVideoChannel(channel)];
    matchNewAdultVideos(results);
    return NextResponse.json({ ok: true, results });
  }

  const results = await scanAllVideos();
  matchNewAdultVideos(results);
  return NextResponse.json({ ok: true, results });
}
