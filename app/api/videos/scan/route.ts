import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { scanAllVideos, scanVideoChannel } from "@/lib/videos";
import { parseVideoChannel } from "@/lib/videos-storage";

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
    return NextResponse.json({ ok: true, results: [scanVideoChannel(channel)] });
  }

  return NextResponse.json({ ok: true, results: scanAllVideos() });
}
