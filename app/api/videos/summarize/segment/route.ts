import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  deleteSegmentSummary,
  segmentSummaries,
  summariseSegment,
} from "@/lib/video-summary";

export const dynamic = "force-dynamic";
// Sixteen keyframe grabs plus a model call: tens of seconds, not milliseconds.
export const maxDuration = 300;

// Read the segment analyses stored for one video. Any signed-in user — the
// text is part of the library, like a description.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const videoId = Number(new URL(request.url).searchParams.get("videoId"));
  if (!Number.isFinite(videoId) || videoId <= 0) {
    return NextResponse.json({ error: "Missing videoId" }, { status: 400 });
  }
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
  deleteSegmentSummary(id);
  return NextResponse.json({ ok: true });
}
