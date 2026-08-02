import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canAccessVideoChannel, getVideo, toggleLike } from "@/lib/videos";

export const dynamic = "force-dynamic";

export async function POST(
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
  return NextResponse.json(toggleLike(video.id, Number(session.sub)));
}
