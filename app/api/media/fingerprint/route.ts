import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { secretMatches } from "@/lib/cron-auth";
import { fingerprintState, startFingerprintRun } from "@/lib/media-dedup";

export const dynamic = "force-dynamic";

// Progress for the UI and the scheduler. Fingerprinting costs no API calls,
// only CPU, so this is free to poll.
export async function GET() {
  const session = await getSession();
  if (session?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(fingerprintState());
}

// Start a run. Admin session (the button) or the scheduler's shared secret.
export async function POST(request: Request) {
  const session = await getSession();
  const secret = process.env.IMPORT_CRON_SECRET;
  const isCron = secretMatches(request.headers.get("x-import-secret"), secret);
  if (session?.role !== "admin" && !isCron) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const budget = Number(new URL(request.url).searchParams.get("budgetMs"));
  return NextResponse.json({
    ok: true,
    ...startFingerprintRun(
      Number.isFinite(budget) && budget > 0 ? budget : undefined
    ),
  });
}
