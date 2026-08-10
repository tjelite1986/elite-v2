import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canAccessVideoChannel, getVideo } from "@/lib/videos";
import {
  performersForVideo,
  setManualVideoPerformers,
} from "@/lib/video-performers";

export const dynamic = "force-dynamic";

// The cast attached to one 18+ video. Reading it needs the 18+ gate; changing
// it is an admin action, like every other library-wide edit.
async function load(id: string, needAdmin: boolean) {
  const session = await getSession();
  if (!session) return { error: "Unauthorized", status: 401 as const };
  if (needAdmin && session.role !== "admin") {
    return { error: "Forbidden", status: 403 as const };
  }
  const video = getVideo(Number(id));
  if (!video) return { error: "Not found", status: 404 as const };
  if (video.channel !== "adults") {
    return { error: "Performers are 18+ only", status: 400 as const };
  }
  if (!(await canAccessVideoChannel(video.channel))) {
    return { error: "Forbidden", status: 403 as const };
  }
  return { video };
}

export async function GET(
  _request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;
  const loaded = await load(id, false);
  if ("error" in loaded) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }
  return NextResponse.json({ performers: performersForVideo(loaded.video.id) });
}

// Replace the cast with the list of slugs given: { slugs: ["dee-williams"] }.
export async function PUT(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;
  const loaded = await load(id, true);
  if ("error" in loaded) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }
  const body = await request.json().catch(() => ({}));
  const slugs = Array.isArray(body?.slugs)
    ? body.slugs.filter((s: unknown): s is string => typeof s === "string")
    : null;
  if (!slugs) {
    return NextResponse.json({ error: "slugs must be an array" }, { status: 400 });
  }
  setManualVideoPerformers(loaded.video.id, slugs);
  return NextResponse.json({ performers: performersForVideo(loaded.video.id) });
}
