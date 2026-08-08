import { NextResponse } from "next/server";
import { getSession, secretMatches } from "@/lib/auth";
import {
  requeueTranscode,
  startTranscodeOne,
  startTranscodeRun,
  transcodeState,
} from "@/lib/videos";

export const dynamic = "force-dynamic";

// Queue state: what is left, whether a run is going, and how the last one ended.
// This is what the UI and the scheduler poll — the POST below returns as soon as
// the work is started, never when it finishes. Same admin-or-cron gate as POST:
// the state isn't sensitive, but every other route in this queue self-gates.
export async function GET(request: Request) {
  const session = await getSession();
  const secret = process.env.IMPORT_CRON_SECRET;
  const isCron = secretMatches(request.headers.get("x-import-secret"), secret);
  if (session?.role !== "admin" && !isCron) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(transcodeState());
}

// Start converting queued videos to H.264/AAC MP4. Authorized by an admin
// session (the button) or the scheduler's shared secret (the hourly job).
// ?id=<n> converts just that video (retrying it first if it had failed), so the
// per-video button cannot start hours of encoding.
//
// This returns immediately by design: an encode runs for minutes to hours, and
// an HTTP client gives up long before that (undici cuts a headerless response at
// 5 minutes, which is exactly how the scheduler's first run "failed" while
// ffmpeg carried on). Progress is read from GET.
export async function POST(request: Request) {
  const session = await getSession();
  const secret = process.env.IMPORT_CRON_SECRET;
  const isCron = secretMatches(request.headers.get("x-import-secret"), secret);
  if (session?.role !== "admin" && !isCron) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const one = Number(url.searchParams.get("id"));
  if (Number.isFinite(one) && one > 0) {
    requeueTranscode(one);
    return NextResponse.json({ ok: true, ...startTranscodeOne(one) });
  }

  const budget = Number(url.searchParams.get("budgetMs"));
  return NextResponse.json({
    ok: true,
    ...startTranscodeRun(
      Number.isFinite(budget) && budget > 0 ? budget : undefined
    ),
  });
}
