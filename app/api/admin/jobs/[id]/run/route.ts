import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { JOBS, runJobNow } from "@/lib/jobs-runtime.mjs";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await getSession();
  if (!session || session.role !== "admin") return null;
  return session;
}

// Trigger a job immediately, regardless of its schedule. The actual work runs
// in the background; runJobNow claims the row synchronously (so the UI shows
// "running" right away) and we don't block the request on a potentially long
// job — the panel polls for the result.
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const id = params.id;
  if (!JOBS.some((j: { id: string }) => j.id === id)) {
    return NextResponse.json({ error: "Unknown job" }, { status: 404 });
  }

  runJobNow(id).catch((err: unknown) => {
    console.error(`[jobs] run "${id}" failed:`, err);
  });

  return NextResponse.json({ ok: true });
}
