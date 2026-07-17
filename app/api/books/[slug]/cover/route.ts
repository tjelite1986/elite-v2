import { NextResponse } from "next/server";
import fs from "node:fs";
import { Readable } from "node:stream";
import { getSession } from "@/lib/auth";
import { getBook } from "@/lib/books";
import { db } from "@/lib/db";
import { coverFilePath, isUnderBooksRoot } from "@/lib/books-storage";
import { extractCover, coverExists } from "@/lib/book-covers";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const book = getBook(params.slug);
  if (!book) return new NextResponse("Not found", { status: 404 });

  let coverKey = book.cover_key;
  // Lazily generate the cover on first access if it's missing.
  if (!coverExists(coverKey)) {
    coverKey = await extractCover(book.slug, book.format, book.storage_key);
    if (coverKey) {
      db.prepare("UPDATE books SET cover_key = ? WHERE slug = ?").run(
        coverKey,
        book.slug
      );
    }
  }
  if (!coverKey) return new NextResponse("No cover", { status: 404 });

  const filePath = coverFilePath(coverKey);
  if (!isUnderBooksRoot(filePath) || !fs.existsSync(filePath)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const stream = fs.createReadStream(filePath);
  return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(fs.statSync(filePath).size),
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
