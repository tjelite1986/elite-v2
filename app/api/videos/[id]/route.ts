import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  canAccessVideoChannel,
  deleteVideo,
  getVideo,
  getVideoWithState,
  relatedVideos,
  updateVideo,
} from "@/lib/videos";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const video = getVideoWithState(Number(id), Number(session.sub));
  if (!video) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await canAccessVideoChannel(video.channel))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({
    video,
    related: relatedVideos(video, Number(session.sub)),
  });
}

// Edit the library metadata (title/description). Admin-only: the library is
// shared, so an edit is visible to everyone.
export async function PATCH(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const video = getVideo(Number(id));
  if (!video) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await canAccessVideoChannel(video.channel))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const updated = updateVideo(video.id, {
    title: typeof body.title === "string" ? body.title : undefined,
    description:
      typeof body.description === "string" || body.description === null
        ? body.description
        : undefined,
  });
  return NextResponse.json({ ok: true, video: updated });
}

// Remove a video. ?file=1 also deletes the media from disk — without it the
// next scan would simply re-add the row.
export async function DELETE(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const video = getVideo(Number(id));
  if (!video) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await canAccessVideoChannel(video.channel))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const withFile = new URL(request.url).searchParams.get("file") === "1";
  deleteVideo(video.id, withFile);
  return NextResponse.json({ ok: true, deletedFile: withFile });
}
