import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listBooks, ingestUpload } from "@/lib/books";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_BYTES = 200 * 1024 * 1024; // 200 MB

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ books: listBooks(Number(session.sub)) });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A file is required." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 200 MB)." }, { status: 413 });
  }

  const title = (form?.get("title") as string) || undefined;
  const author = (form?.get("author") as string) || undefined;

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const book = await ingestUpload({
      buffer,
      filename: file.name,
      title,
      author,
      addedBy: Number(session.sub),
    });
    return NextResponse.json({ book });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Upload failed.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
