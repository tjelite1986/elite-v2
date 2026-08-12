import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const GRABBIT = process.env.GRABBIT_URL || "http://grabbit:3000";
const GRABBIT_HEADERS = { "x-grabbit-token": process.env.GRABBIT_INTERNAL_TOKEN || "" };

// Music metadata candidates (iTunes + Deezer) for the "add music from a link"
// form, so a download can be tagged properly before it is filed — grabbit
// derives the library path from those tags ([Artist]/[Album (Year)]/[Title]).
//
// Proxied rather than called from the browser: the lookup is grabbit's, it sits
// behind the internal token, and the app's CSP would block both the API calls
// and the artwork. Covers come back as absolute URLs and the client routes them
// through /api/image-proxy for the same reason.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const q = (new URL(request.url).searchParams.get("q") || "").trim();
  if (!q) {
    return NextResponse.json({ ok: true, candidates: [] });
  }

  try {
    const r = await fetch(
      `${GRABBIT}/api/music-meta?q=${encodeURIComponent(q.slice(0, 200))}`,
      { headers: GRABBIT_HEADERS, signal: AbortSignal.timeout(20000) }
    );
    const data = await r.json().catch(() => ({ ok: false, error: "Lookup failed" }));
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ ok: false, error: "Grabber unreachable" });
  }
}
