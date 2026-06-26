import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listJobs, setJobConfig } from "@/lib/jobs-runtime.mjs";

// Reads cookies (admin session) and live job state, so never cache.
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await getSession();
  if (!session || session.role !== "admin") return null;
  return session;
}

// List every background job with its schedule and last-run status.
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ jobs: listJobs() });
}

// Enable/disable a job or change its interval.
export async function PATCH(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const id: unknown = body.id;
  if (typeof id !== "string" || !id) {
    return NextResponse.json({ error: "Missing job id" }, { status: 400 });
  }

  const patch: { enabled?: boolean; intervalSeconds?: number } = {};
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (body.intervalSeconds !== undefined) {
    const n = Number(body.intervalSeconds);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: "Invalid interval" }, { status: 400 });
    }
    patch.intervalSeconds = n;
  }

  const updated = setJobConfig(id, patch);
  if (!updated) {
    return NextResponse.json({ error: "Unknown job" }, { status: 404 });
  }
  return NextResponse.json({ job: updated });
}
