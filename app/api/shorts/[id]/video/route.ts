import { NextResponse } from "next/server";
import fs from "node:fs";
import { Readable } from "node:stream";
import { getSession } from "@/lib/auth";
import { canAccessChannel, getShort } from "@/lib/shorts";
import { videoPathFor } from "@/lib/shorts-storage";
import { videoMimeFor } from "@/lib/gallery-storage";

export const dynamic = "force-dynamic";

// Stream a short's video with HTTP Range support so <video> can seek and start
// before the full file arrives. Re-checks the 18+ gate here — the media route is
// exactly where the old elite leaked, so it never trusts the page or feed API.
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const short = getShort(Number(params.id));
  if (!short) return new NextResponse("Not found", { status: 404 });
  if (!(await canAccessChannel(short.channel))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const filePath = videoPathFor(short.channel, short.storage_key);
  if (!fs.existsSync(filePath)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const size = fs.statSync(filePath).size;
  // Derive the Content-Type server-side from the on-disk extension via a fixed
  // allowlist — never echo the uploaded/stored mime, which is attacker-supplied
  // (file.type) and could otherwise be set to text/html for a stored XSS.
  // nosniff + inline disposition stop the browser from re-interpreting it.
  const contentType = videoMimeFor(short.storage_key);
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=86400",
  };

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
