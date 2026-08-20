import { NextResponse } from "next/server";
import { getSession, secretMatches } from "@/lib/auth";
import { metadataState, startMetadataRun } from "@/lib/video-metadata";

export const dynamic = "force-dynamic";

// Queue state for the automatic matcher (what the library polls).
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(metadataState());
}

// Start an automatic matching pass. Admin session or the scheduler's secret.
// Returns as soon as the run starts — the pass is many third-party calls and
// outlives the request, same contract as the transcode queue.
export async function POST(request: Request) {
  const session = await getSession();
  const secret = process.env.IMPORT_CRON_SECRET;
  const isCron = secretMatches(request.headers.get("x-import-secret"), secret);
  if (session?.role !== "admin" && !isCron) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, ...startMetadataRun() });
}
