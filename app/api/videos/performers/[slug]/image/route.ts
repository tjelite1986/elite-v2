import { NextResponse } from "next/server";
import fs from "node:fs";
import { getSession } from "@/lib/auth";
import { canAccessVideoChannel } from "@/lib/videos";
import { getPerformer, performerImage } from "@/lib/video-performers";
import { isUnderPosters, posterFilePath } from "@/lib/videos-storage";

export const dynamic = "force-dynamic";

// ?i=<n> serves the n-th gallery photo; without it, the portrait.
export async function GET(
  request: Request,
  props: { params: Promise<{ slug: string }> }
) {
  const { slug } = await props.params;
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });
  if (!(await canAccessVideoChannel("adults"))) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const raw = new URL(request.url).searchParams.get("i");
  const key =
    raw !== null && Number.isFinite(Number(raw))
      ? performerImage(slug, Number(raw))
      : getPerformer(slug)?.image_key;
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
