import { NextResponse } from "next/server";
import fs from "node:fs";
import { getSession } from "@/lib/auth";
import { canAccessVideoChannel, getVideo } from "@/lib/videos";
import { isUnderPosters, posterFilePath } from "@/lib/videos-storage";

export const dynamic = "force-dynamic";

// Poster frame for a video, or its scrub storyboard sheet with ?storyboard=1.
// Both are generated JPEGs under VIDEOS_ROOT/.posters.
export async function GET(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params;
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const video = getVideo(Number(id));
  if (!video) return new NextResponse("Not found", { status: 404 });
  if (!(await canAccessVideoChannel(video.channel))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const wantStoryboard = params.get("storyboard") === "1";
  // Matched artwork (from a .nfo sidecar or ThePornDB) is the real cover, so it
  // wins over the ffmpeg frame. ?frame=1 asks for the generated one explicitly.
  const preferFrame = params.get("frame") === "1";
  const key = wantStoryboard
    ? video.storyboard_key
    : (!preferFrame && video.meta_poster_key) || video.poster_key;
  if (!key) return new NextResponse("Not found", { status: 404 });

  const filePath = posterFilePath(key);
  if (!isUnderPosters(filePath) || !fs.existsSync(filePath)) {
    return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse(new Uint8Array(fs.readFileSync(filePath)), {
    headers: {
      "Content-Type": "image/jpeg",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=86400",
    },
  });
}
