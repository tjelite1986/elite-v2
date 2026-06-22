import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const LADDA = process.env.LADDA_URL || "http://ladda:3000";

// Proxy to the ladda grabber: resolve a single video URL (admin only).
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(req.url).searchParams.get("url") || "";
  try {
    const r = await fetch(`${LADDA}/api/resolve?url=${encodeURIComponent(url)}`);
    return NextResponse.json(await r.json(), { status: r.status });
  } catch {
    return NextResponse.json({ ok: false, error: "Grabber unreachable" }, { status: 502 });
  }
}
