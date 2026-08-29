import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { assertDownloadableUrl } from "@/lib/shorts-download";

export const dynamic = "force-dynamic";

const GRABBIT = process.env.GRABBIT_URL || process.env.LADDA_URL || "http://grabbit:3000";
const GRABBIT_HEADERS = { "x-grabbit-token": process.env.GRABBIT_INTERNAL_TOKEN || "" };

// Proxy to the grabbit grabber: resolve a single video URL (admin only).
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const url = new URL(req.url).searchParams.get("url") || "";
  try {
    await assertDownloadableUrl(url);
  } catch {
    return NextResponse.json({ ok: false, error: "That URL isn't reachable." });
  }
  try {
    const r = await fetch(`${GRABBIT}/api/resolve?url=${encodeURIComponent(url)}`, { headers: GRABBIT_HEADERS });
    // The status is deliberately not forwarded: Cloudflare replaces a 5xx
    // body with its own HTML page, and every caller reads `ok` from the JSON.
    return NextResponse.json(await r.json());
  } catch {
    // 200, not 502: Cloudflare swallows a 5xx body and serves its own HTML
    // error page, so the client would parse "<!DOCTYPE" instead of this.
    // The failure is reported in the payload, which every caller reads.
    return NextResponse.json({ ok: false, error: "Grabber unreachable" });
  }
}
