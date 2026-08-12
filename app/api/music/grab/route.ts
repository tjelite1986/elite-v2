import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isMusicLibrary } from "@/lib/subsonic";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GRABBIT = process.env.GRABBIT_URL || "http://grabbit:3000";
const GRABBIT_HEADERS = { "x-grabbit-token": process.env.GRABBIT_INTERNAL_TOKEN || "" };

// Queue a download straight into the Navidrome library via Grabbit, which does
// the tagging and library sorting (dest=navidrome is jobs-API only for exactly
// that reason). The file appears in /music after Navidrome's next scan; the
// scan interval is hourly, and the Navidrome UI can force one.
//
// Admin only: this writes into the shared music library, not a personal folder.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    url?: string;
    library?: string;
    artists?: string;
    album?: string;
    title?: string;
    genres?: string;
    date?: string;
    release?: string;
  } | null;

  const url = (body?.url || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    return NextResponse.json({ ok: false, error: "Invalid URL" }, { status: 400 });
  }

  const qs = new URLSearchParams({
    url,
    dest: "navidrome",
    lib: isMusicLibrary(body?.library) ? body.library : "main",
    device: "0",
  });
  // Optional tag overrides — Grabbit writes these into the file before filing it.
  for (const key of ["artists", "album", "title", "genres", "date", "release"] as const) {
    const value = body?.[key];
    if (typeof value === "string" && value.trim()) qs.set(key, value.trim());
  }

  try {
    const r = await fetch(`${GRABBIT}/api/jobs/start?${qs.toString()}`, {
      headers: GRABBIT_HEADERS,
    });
    const data = await r.json().catch(() => ({ ok: false, error: "Download failed" }));
    return NextResponse.json(data);
  } catch {
    // 200 with the failure in the body: Cloudflare replaces a 5xx body with its
    // own HTML page, which the client would fail to parse as JSON.
    return NextResponse.json({ ok: false, error: "Grabber unreachable" });
  }
}
