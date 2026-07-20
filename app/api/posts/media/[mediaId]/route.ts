import { NextResponse } from "next/server";
import fs from "node:fs";
import { Readable } from "node:stream";
import { PostMediaRow, PostRow } from "@/lib/db";
import { qb, getOne } from "@/lib/kysely";
import { getSession } from "@/lib/auth";
import { has18Access } from "@/lib/shorts-gate";
import { mediaPathFor, thumbKeyFor, mediaMimeFor, isVideoKey } from "@/lib/posts-storage";

export const dynamic = "force-dynamic";

// Serve a post's media file (display or ?size=thumb; a video's thumb is its
// poster frame). Videos are streamed with HTTP Range support so <video> can
// seek and start before the full file arrives. Re-checks the 18+ gate here —
// the media route is exactly where access must not be assumed from the page or
// feed API. Content-Type is derived from the on-disk extension, never echoed.
export async function GET(request: Request, props: { params: Promise<{ mediaId: string }> }) {
  const params = await props.params;
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

  const size = fs.statSync(filePath).size;
  const headers: Record<string, string> = {
    "Content-Type": mediaMimeFor(key),
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
    "Cache-Control": "private, max-age=86400",
  };

  // Range support for video playback (Safari refuses to play without it).
  if (!wantThumb && isVideoKey(media.storage_key)) {
    headers["Accept-Ranges"] = "bytes";
    const range = request.headers.get("range");
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start: number;
      let end: number;
      if (m && !m[1] && m[2]) {
        // Suffix form (bytes=-N, RFC 7233 §2.1): the LAST N bytes.
        start = Math.max(0, size - parseInt(m[2], 10));
        end = size - 1;
      } else {
        start = m && m[1] ? parseInt(m[1], 10) : 0;
        end = m && m[2] ? parseInt(m[2], 10) : size - 1;
      }
      if (isNaN(start) || start < 0) start = 0;
      if (isNaN(end) || end >= size) end = size - 1;
      if (start > end) {
        return new NextResponse("Range Not Satisfiable", {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      }
      const stream = fs.createReadStream(filePath, { start, end });
      return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
        status: 206,
        headers: {
          ...headers,
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Content-Length": String(end - start + 1),
        },
      });
    }
  }

  // Stream from disk instead of buffering the whole file into memory (matches
  // the gallery media route); avoids RAM spikes on large uploads.
  const stream = fs.createReadStream(filePath);
  return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
    status: 200,
    headers: { ...headers, "Content-Length": String(size) },
  });
}
