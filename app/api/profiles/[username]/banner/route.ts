import { NextResponse } from "next/server";
import fs from "node:fs";
import { getSession } from "@/lib/auth";
import { getProfileExtras } from "@/lib/profiles";
import { handleOf } from "@/lib/directory";
import { avatarPathFor, imageMimeFor } from "@/lib/posts-storage";

export const dynamic = "force-dynamic";

// Serve a profile's cover banner by handle. 404 when none is set. Revalidated
// via an ETag keyed to the banner file so a change shows immediately.
export async function GET(
  request: Request,
  { params }: { params: { username: string } }
) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const bannerKey = getProfileExtras(handleOf(params.username))?.banner_key;
  if (!bannerKey) return new NextResponse("Not found", { status: 404 });
  const filePath = avatarPathFor(bannerKey); // avatarPathFor just joins POSTS_ROOT
  if (!fs.existsSync(filePath)) return new NextResponse("Not found", { status: 404 });

  const etag = `"${bannerKey}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": "private, no-cache" },
    });
  }
  return new NextResponse(fs.readFileSync(filePath), {
    headers: {
      "Content-Type": imageMimeFor(bannerKey),
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      ETag: etag,
      "Cache-Control": "private, no-cache",
    },
  });
}
