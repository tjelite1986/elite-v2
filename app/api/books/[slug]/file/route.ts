import { NextResponse } from "next/server";
import fs from "node:fs";
import { Readable } from "node:stream";
import { getSession } from "@/lib/auth";
import { getBook } from "@/lib/books";
import { bookFilePath, isUnderBooksRoot } from "@/lib/books-storage";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  epub: "application/epub+zip",
  pdf: "application/pdf",
  cbz: "application/vnd.comicbook+zip",
};

// Serve the raw book file. Same-origin reader fetches carry the httpOnly session
// cookie, so plain session auth is enough (no media token needed). Range support
// lets pdf.js fetch byte ranges.
export async function GET(request: Request, props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const book = getBook(params.slug);
  if (!book) return new NextResponse("Not found", { status: 404 });

  const filePath = bookFilePath(book.storage_key);
  if (!isUnderBooksRoot(filePath) || !fs.existsSync(filePath)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const size = fs.statSync(filePath).size;
  const contentType = MIME[book.format] || "application/octet-stream";
  const baseHeaders: Record<string, string> = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  };

  const range = request.headers.get("range");
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start: number;
    let end: number;
    if (m && !m[1] && m[2]) {
      // Suffix form (bytes=-N, RFC 7233 §2.1): the LAST N bytes — pdf.js sends
      // this to grab the xref table at the end of a large PDF.
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
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }

  const stream = fs.createReadStream(filePath);
  return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
    headers: { ...baseHeaders, "Content-Length": String(size) },
  });
}
