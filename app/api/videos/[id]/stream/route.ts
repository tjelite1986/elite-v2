import { NextResponse } from "next/server";
import fs from "node:fs";
import { Readable } from "node:stream";
import { getSession } from "@/lib/auth";
import { canAccessVideoChannel, getVideo } from "@/lib/videos";
import {
  isUnderChannel,
  videoFilePath,
  videoMime,
} from "@/lib/videos-storage";

export const dynamic = "force-dynamic";

// Stream a long-form video with HTTP Range support — mandatory here: without
// 206 responses the player can't seek and the browser buffers the whole file
// before playback starts. The 18+ gate is re-checked on this route because the
// media URL is exactly what leaks when only the page is gated.
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

  const filePath = videoFilePath(video.channel, video.storage_key);
  if (!isUnderChannel(video.channel, filePath) || !fs.existsSync(filePath)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const size = fs.statSync(filePath).size;
  const wantDownload =
    new URL(request.url).searchParams.get("download") === "1";
  const stem =
    video.title
      .replace(/[^\x20-\x7E]/g, "")
      .replace(/[/\\:*?"<>|#]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || `video-${video.id}`;
  const ext = video.storage_key.split(".").pop() || "mp4";

  const headers: Record<string, string> = {
    // Derived from the on-disk extension via a fixed allowlist, never echoed
    // from client input — with nosniff this stops a stored-XSS reinterpretation.
    "Content-Type": videoMime(video.storage_key),
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": wantDownload
      ? `attachment; filename="${stem}.${ext}"`
      : "inline",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=86400",
  };

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
    return new NextResponse(
      Readable.toWeb(stream) as unknown as ReadableStream,
      {
        status: 206,
        headers: {
          ...headers,
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Content-Length": String(end - start + 1),
        },
      }
    );
  }

  const stream = fs.createReadStream(filePath);
  return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
    status: 200,
    headers: { ...headers, "Content-Length": String(size) },
  });
}
