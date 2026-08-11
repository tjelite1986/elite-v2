import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canAccessVideoChannel } from "@/lib/videos";
import type { VideoChannel } from "@/lib/db";
import {
  deleteSegmentSummary,
  segmentOwner,
  segmentSummaries,
  summariseSegment,
  videoChannelOf,
} from "@/lib/video-summary";

export const dynamic = "force-dynamic";
// Sixteen keyframe grabs plus a model call: tens of seconds, not milliseconds.
export const maxDuration = 300;

// The 18+ gate is per user and PIN-backed, so "is an admin" is not the same
// thing as "is entitled to this channel right now". Every handler here checks
// the channel of the video it is about — a route that skipped it would be a
// way around the user's own lock, since the analysis text describes the video.
// A denial is 404, not 403: existence of an 18+ row is itself information.
async function denyByChannel(
  channel: VideoChannel | null
): Promise<NextResponse | null> {
  if (!channel) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await canAccessVideoChannel(channel))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return null;
}

// Read the segment analyses stored for one video. Any signed-in user with
// access to that video's channel — the text is part of the library.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const videoId = Number(new URL(request.url).searchParams.get("videoId"));
  if (!Number.isFinite(videoId) || videoId <= 0) {
    return NextResponse.json({ error: "Missing videoId" }, { status: 400 });
  }

  const denied = await denyByChannel(videoChannelOf(videoId));
  if (denied) return denied;

  return NextResponse.json({ segments: segmentSummaries(videoId) });
}

// Analyse one stretch of a video. Admin only: each call costs an API request,
// and the caller chooses how many to make.
export async function POST(request: Request) {
  const session = await getSession();
  if (session?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    videoId?: number;
    from?: number;
    to?: number;
  };
  const videoId = Number(body.videoId);
  const from = Number(body.from);
  const to = Number(body.to);
  if (!Number.isFinite(videoId) || videoId <= 0) {
    return NextResponse.json({ error: "Missing videoId" }, { status: 400 });
  }
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return NextResponse.json(
      { error: "from and to must be seconds" },
      { status: 400 }
    );
  }

  const denied = await denyByChannel(videoChannelOf(videoId));
  if (denied) return denied;

  try {
    const segment = await summariseSegment(videoId, from, to);
    return NextResponse.json({ ok: true, segment });
  } catch (err) {
    return NextResponse.json(
      { error: String((err as Error)?.message || err) },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (session?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  // Resolve the segment's own video before deleting: the id says nothing
  // about which channel it belongs to.
  const owner = segmentOwner(id);
  const denied = await denyByChannel(owner?.channel ?? null);
  if (denied) return denied;

  deleteSegmentSummary(id);
  return NextResponse.json({ ok: true });
}
