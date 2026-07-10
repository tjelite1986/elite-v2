import { NextResponse } from "next/server";
import fs from "node:fs";
import { Readable } from "node:stream";
import { getSession } from "@/lib/auth";
import { isFollowing } from "@/lib/posts";
import { getStory } from "@/lib/stories";
import { mediaPathFor, imageMimeFor } from "@/lib/posts-storage";

export const dynamic = "force-dynamic";

// Stream a story image. Viewable by the author or someone who follows them — the
// same scope as the rail, re-checked here rather than assumed.
export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });
  const viewerId = Number(session.sub);

  const story = getStory(Number(params.id));
  if (!story) return new NextResponse("Not found", { status: 404 });

  if (
    story.author_user_id !== viewerId &&
    !isFollowing(viewerId, "user", story.author_user_id)
  ) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const filePath = mediaPathFor(story.storage_key);
  if (!fs.existsSync(filePath)) return new NextResponse("Not found", { status: 404 });

  const stream = fs.createReadStream(filePath);
  return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
    headers: {
      "Content-Type": imageMimeFor(story.storage_key),
      "Content-Length": String(fs.statSync(filePath).size),
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
