import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  requeueSummary,
  startSummaryOne,
  startSummaryRun,
  summaryState,
} from "@/lib/video-summary";

export const dynamic = "force-dynamic";

// Queue state: how many videos still lack a summary, whether a run is going,
// and how the last one ended. The UI and the scheduler poll this — the POST
// below returns as soon as the work is started, never when it finishes.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(summaryState());
}

// Start summarising. Authorized by an admin session (the button) or the
// scheduler's shared secret (the hourly job). ?id=<n> summarises just that
// video, retrying it first if a previous attempt failed.
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
    requeueSummary(one);
    return NextResponse.json({ ok: true, ...startSummaryOne(one) });
  }

  const budget = Number(url.searchParams.get("budgetMs"));
  return NextResponse.json({
    ok: true,
    ...startSummaryRun(
      Number.isFinite(budget) && budget > 0 ? budget : undefined
    ),
  });
}
