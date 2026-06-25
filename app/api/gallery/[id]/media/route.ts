import { NextResponse } from "next/server";
import fs from "node:fs";
import { Readable } from "node:stream";
import { GalleryItemRow } from "@/lib/db";
import { qb, getOne } from "@/lib/kysely";
import { getSession } from "@/lib/auth";
import {
  originalPathFor,
  thumbPathFor,
  previewPathFor,
  isSupportedVideo,
  videoMimeFor,
} from "@/lib/gallery-storage";
import { imageMimeFor } from "@/lib/posts-storage";
import { canViewItem } from "@/lib/gallery-share";

export const dynamic = "force-dynamic";

// Serve a media variant. Viewable if the user owns the item OR it was shared
// with them in a message. Files are read from the OWNER's storage (item.user_id).
// The httpOnly session cookie rides same-origin <img> requests.
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const userId = Number(session.sub);

  const item = getOne<GalleryItemRow>(
    qb
      .selectFrom("gallery_items")
      .selectAll()
      .where("id", "=", Number(params.id))
      .where("is_deleted", "=", 0)
  );
  if (!item) {
    return new NextResponse("Not found", { status: 404 });
  }
  if (item.user_id !== userId && !canViewItem(userId, item.id)) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const ownerId = item.user_id;

  const url = new URL(request.url);
  const variant = url.searchParams.get("variant") || "thumb";
  // Decide media kind from the stored file extension, never the (client-supplied)
  // mime_type — so a mislabeled upload can't steer how it's served.
  const isVideo = isSupportedVideo(item.storage_key, "");

  // Thumb/preview are always the generated JPEG derivatives (a poster frame for
  // videos), so they're served the same way for both media types.
  if (variant !== "original") {
    const filePath =
      variant === "preview"
        ? previewPathFor(ownerId, item.storage_key)
        : thumbPathFor(ownerId, item.storage_key);
    if (!fs.existsSync(filePath)) {
      return new NextResponse("Not found", { status: 404 });
    }
    return new NextResponse(fs.readFileSync(filePath), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  // Original. Content-Type derived server-side from the extension (not the stored
  // client mime), plus nosniff, so a mislabeled file can't be served as an
  // executable type.
  const filePath = originalPathFor(ownerId, item.storage_key);
  const contentType = isVideo
    ? videoMimeFor(item.storage_key)
    : imageMimeFor(item.storage_key);
  if (!fs.existsSync(filePath)) {
    return new NextResponse("Not found", { status: 404 });
  }
  const wantDownload = url.searchParams.get("dl") === "1";

  // Videos stream with HTTP Range support so <video> can play and seek without
  // pulling the whole file into memory; images are sent whole as a download.
  if (isVideo) {
    return streamFile(request, filePath, contentType, {
      attachment: wantDownload ? item.filename : null,
    });
  }

  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": "private, max-age=86400",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `attachment; filename="${item.filename.replace(/"/g, "")}"`,
  };
  return new NextResponse(fs.readFileSync(filePath), { headers });
}

// Stream a file with Range support (206 partial content). Used for video so the
// browser can seek and start playback before the full file arrives.
function streamFile(
  request: Request,
  filePath: string,
  contentType: string,
  opts: { attachment: string | null }
): NextResponse {
  const size = fs.statSync(filePath).size;
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=86400",
    "X-Content-Type-Options": "nosniff",
  };
  if (opts.attachment) {
    headers["Content-Disposition"] = `attachment; filename="${opts.attachment.replace(/"/g, "")}"`;
  }

  const range = request.headers.get("range");
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
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

  const stream = fs.createReadStream(filePath);
  return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
    status: 200,
    headers: { ...headers, "Content-Length": String(size) },
  });
}
