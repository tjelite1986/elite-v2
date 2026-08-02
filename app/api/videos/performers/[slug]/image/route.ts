import { NextResponse } from "next/server";
import fs from "node:fs";
import { getSession } from "@/lib/auth";
import { canAccessVideoChannel } from "@/lib/videos";
import { getPerformer } from "@/lib/video-performers";
import { isUnderPosters, posterFilePath } from "@/lib/videos-storage";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  props: { params: Promise<{ slug: string }> }
) {
  const { slug } = await props.params;
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });
  if (!(await canAccessVideoChannel("adults"))) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const performer = getPerformer(slug);
  if (!performer?.image_key) return new NextResponse("Not found", { status: 404 });

  const filePath = posterFilePath(performer.image_key);
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
