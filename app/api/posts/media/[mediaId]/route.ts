import { NextResponse } from "next/server";
import fs from "node:fs";
import { Readable } from "node:stream";
import { PostMediaRow, PostRow } from "@/lib/db";
import { qb, getOne } from "@/lib/kysely";
import { getSession } from "@/lib/auth";
import { has18Access } from "@/lib/shorts-gate";
import { mediaPathFor, thumbKeyFor, imageMimeFor } from "@/lib/posts-storage";

export const dynamic = "force-dynamic";

// Serve a post image (display or ?size=thumb). Re-checks the 18+ gate here —
// the media route is exactly where access must not be assumed from the page or
// feed API. Content-Type is derived from the on-disk extension, never echoed.
export async function GET(
  request: Request,
  { params }: { params: { mediaId: string } }
) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const media = getOne<PostMediaRow>(
    qb.selectFrom("post_media").selectAll().where("id", "=", Number(params.mediaId))
  );
  if (!media) return new NextResponse("Not found", { status: 404 });

  const post = getOne<PostRow>(
    qb.selectFrom("posts").selectAll().where("id", "=", media.post_id).where("is_deleted", "=", 0)
  );
  if (!post) return new NextResponse("Not found", { status: 404 });

  if (post.is_adult && !(await has18Access())) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const wantThumb = new URL(request.url).searchParams.get("size") === "thumb";
  const key = wantThumb ? thumbKeyFor(media.storage_key) : media.storage_key;
  const filePath = mediaPathFor(key);
  if (!fs.existsSync(filePath)) return new NextResponse("Not found", { status: 404 });

  // Stream from disk instead of buffering the whole image into memory (matches
  // the gallery media route); avoids RAM spikes on large uploads.
  const stream = fs.createReadStream(filePath);
  return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
    headers: {
      "Content-Type": imageMimeFor(media.storage_key),
      "Content-Length": String(fs.statSync(filePath).size),
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=86400",
    },
  });
}
