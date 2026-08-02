import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canAccessVideoChannel } from "@/lib/videos";
import { enrichPerformer, getPerformer } from "@/lib/video-performers";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(
  _request: Request,
  props: { params: Promise<{ slug: string }> }
) {
  const { slug } = await props.params;
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await canAccessVideoChannel("adults"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const performer = getPerformer(slug);
  if (!performer) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ performer });
}

// Re-fetch the profile from ThePornDB (the Refresh button).
export async function POST(
  _request: Request,
  props: { params: Promise<{ slug: string }> }
) {
  const { slug } = await props.params;
  const session = await getSession();
  if (session?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await canAccessVideoChannel("adults"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const ok = await enrichPerformer(slug);
  return NextResponse.json({
    ok,
    performer: getPerformer(slug),
    message: ok ? "Profile updated." : "No matching profile found.",
  });
}
