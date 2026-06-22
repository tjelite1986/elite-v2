import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const LADDA = process.env.LADDA_URL || "http://ladda:3000";

// Proxy to the ladda grabber: list every clip on a profile (admin only).
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(req.url).searchParams.get("url") || "";
  try {
    const r = await fetch(`${LADDA}/api/profile?url=${encodeURIComponent(url)}`);
    return NextResponse.json(await r.json(), { status: r.status });
  } catch {
    return NextResponse.json({ ok: false, error: "Grabber unreachable" }, { status: 502 });
  }
}
