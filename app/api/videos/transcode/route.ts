import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  isTranscoding,
  pendingTranscodes,
  requeueTranscode,
  transcodeOne,
  transcodePendingVideos,
} from "@/lib/videos";

export const dynamic = "force-dynamic";
// Encoding is the longest job in the app; the queue runner stops on its own
// time budget well before this ceiling.
export const maxDuration = 3600;

// Queue state, for the Convert button in the library.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    pending: pendingTranscodes(),
    running: isTranscoding(),
  });
}

// Convert queued videos to H.264/AAC MP4. Authorized by an admin session (the
// button) or the scheduler's shared secret (the hourly job). ?id=<n> converts
// just that video (retrying it first if it had failed) — the per-video button
// must not start the whole backlog.
export async function POST(request: Request) {
  const session = await getSession();
  const secret = process.env.IMPORT_CRON_SECRET;
  const isCron =
    Boolean(secret) && request.headers.get("x-import-secret") === secret;
  if (session?.role !== "admin" && !isCron) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const one = Number(url.searchParams.get("id"));
  if (Number.isFinite(one) && one > 0) {
    requeueTranscode(one);
    return NextResponse.json({ ok: true, ...(await transcodeOne(one)) });
  }

  const budget = Number(url.searchParams.get("budgetMs"));
  const result = await transcodePendingVideos(
    Number.isFinite(budget) && budget > 0 ? budget : undefined
  );
  return NextResponse.json({ ok: true, ...result });
}
