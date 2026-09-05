import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { has18Access } from "@/lib/shorts-gate";
import { secretMatches } from "@/lib/cron-auth";
import {
  requeueShortSummary,
  shortChannelOf,
  shortSummaryOf,
  shortSummaryState,
  startShortSummaryOne,
  startShortSummaryRun,
} from "@/lib/short-summary";

export const dynamic = "force-dynamic";

// Queue state for the UI and the scheduler. POST returns as soon as the work
// is started, never when it finishes.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ?id=<n> reads back one clip's description — what the UI polls for after
  // starting a run. Same 18+ gate as everything else here.
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (Number.isFinite(id) && id > 0) {
    const channel = shortChannelOf(id);
    if (!channel) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (channel === "18plus" && !(await has18Access())) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ summary: shortSummaryOf(id) });
  }

  return NextResponse.json(shortSummaryState());
}

// Start summarising. Admin session (the button) or the scheduler's shared
// secret (the hourly job). ?id=<n> describes just that clip.
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
    // The 18+ gate is per user and PIN-backed, so an admin session is not by
    // itself entitlement to that channel. 404 rather than 403: the existence
    // of the clip is itself information.
    const channel = shortChannelOf(one);
    if (!channel) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (channel === "18plus" && !isCron && !(await has18Access())) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    requeueShortSummary(one);
    return NextResponse.json({ ok: true, ...startShortSummaryOne(one) });
  }

  const budget = Number(url.searchParams.get("budgetMs"));
  return NextResponse.json({
    ok: true,
    ...startShortSummaryRun(
      Number.isFinite(budget) && budget > 0 ? budget : undefined
    ),
  });
}
