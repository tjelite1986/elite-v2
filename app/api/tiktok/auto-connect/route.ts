import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { autoConnectTiktok } from "@/lib/tiktok";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Admin: link post-creator folders to TikTok where the folder name is a real
// TikTok account. Bounded per call; returns counts so the UI can run it again
// for the remainder.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as { limit?: number };
  const limit = Math.max(1, Math.min(Number(body.limit) || 60, 200));
  const result = await autoConnectTiktok(limit);
  return NextResponse.json({ ok: true, ...result });
}
