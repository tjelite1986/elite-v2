import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const GRABBIT = process.env.GRABBIT_URL || process.env.LADDA_URL || "http://grabbit:3000";
const GRABBIT_HEADERS = { "x-grabbit-token": process.env.GRABBIT_INTERNAL_TOKEN || "" };

// Proxy to the grabbit grabber: list supported sites (admin only).
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  try {
    const r = await fetch(`${GRABBIT}/api/sites`, { headers: GRABBIT_HEADERS });
    return NextResponse.json(await r.json(), { status: r.status });
  } catch {
    return NextResponse.json({ ok: false, error: "Grabber unreachable" }, { status: 502 });
  }
}
