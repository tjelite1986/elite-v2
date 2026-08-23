import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  canAccessVideoChannel,
  clearProgress,
  getVideo,
  saveProgress,
} from "@/lib/videos";

export const dynamic = "force-dynamic";

// Save the viewer's playback position so the video resumes where they stopped.
// Called on a timer while playing, on pause, and via sendBeacon on unload —
// which posts text/plain, so the body is parsed leniently.
export async function POST(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const video = getVideo(Number(id));
  if (!video) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await canAccessVideoChannel(video.channel))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const raw = await request.text();
  let body: { position?: unknown } = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const position = Number(body.position);
  if (!Number.isFinite(position)) {
    return NextResponse.json({ error: "Invalid position" }, { status: 400 });
  }

  saveProgress(video.id, Number(session.sub), position, video.duration);
  return NextResponse.json({ ok: true });
}

// Forget the saved position (the "Start over" action).
export async function DELETE(
  _request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const video = getVideo(Number(id));
  if (!video) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await canAccessVideoChannel(video.channel))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  clearProgress(video.id, Number(session.sub));
  return NextResponse.json({ ok: true });
}
