import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const LADDA = process.env.LADDA_URL || "http://ladda:3000";

// Proxy to the ladda grabber: download one clip into the channel's import folder
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
  if (sp.get("web") === "1") qs.set("web", "1");
  if (sp.get("quality")) qs.set("quality", sp.get("quality") as string);
  try {
    const r = await fetch(`${LADDA}/api/download?${qs.toString()}`);
    const data = await r.json().catch(() => ({ ok: false, error: "Download failed" }));
    return NextResponse.json(data, { status: r.status });
  } catch {
    return NextResponse.json({ ok: false, error: "Grabber unreachable" }, { status: 502 });
  }
}
