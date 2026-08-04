import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const GRABBIT = process.env.GRABBIT_URL || process.env.LADDA_URL || "http://grabbit:3000";
const GRABBIT_HEADERS = { "x-grabbit-token": process.env.GRABBIT_INTERNAL_TOKEN || "" };

// Proxy to the grabbit grabber: download one clip into the channel's import folder
// (save-only — device=0). Admin only.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const sp = new URL(req.url).searchParams;
  const qs = new URLSearchParams({
    url: sp.get("url") || "",
    channel: sp.get("channel") === "18plus" ? "18plus" : "main",
    device: "0",
  });
  if (sp.get("creator")) qs.set("creator", sp.get("creator") as string);
  // Metadata a person edited before saving. Passed through even when empty —
  // an empty description is a deliberate "no caption", which grabbit honours
  // (it tests for the parameter being present, not truthy).
  if (sp.get("title") != null) qs.set("title", sp.get("title") as string);
  if (sp.get("description") != null) qs.set("description", sp.get("description") as string);
  if (sp.get("tags") != null) qs.set("tags", sp.get("tags") as string);
  if (sp.get("web") === "1") qs.set("web", "1");
  if (sp.get("quality")) qs.set("quality", sp.get("quality") as string);
  try {
    const r = await fetch(`${GRABBIT}/api/download?${qs.toString()}`, { headers: GRABBIT_HEADERS });
    const data = await r.json().catch(() => ({ ok: false, error: "Download failed" }));
    // Upstream failures are reported in the body, not the status, so the
    // client always gets JSON back (see the catch below).
    return NextResponse.json(data);
  } catch {
    // 200, not 502: Cloudflare swallows a 5xx body and serves its own HTML
    // error page, so the client would parse "<!DOCTYPE" instead of this.
    // The failure is reported in the payload, which every caller reads.
    return NextResponse.json({ ok: false, error: "Grabber unreachable" });
  }
}
