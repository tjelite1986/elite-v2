import { NextResponse } from "next/server";
import fs from "node:fs";
import { Readable } from "node:stream";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { canAccessChannel, canViewShort, getShort } from "@/lib/shorts";
import { posterPathFor, setCustomPoster } from "@/lib/shorts-storage";

export const dynamic = "force-dynamic";

// Serve a short's poster (JPEG). Same gate enforcement as the video route.
// no-cache + an ETag from the file: every render revalidates, so a changed
// cover ("Thumbnail" button) shows up immediately — an unchanged one is a
// cheap 304. (The old private,max-age=86400 kept serving a day-old cover.)
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const short = getShort(Number(params.id));
  if (!short || !short.poster_key) {
    return new NextResponse("Not found", { status: 404 });
  }
  if (!canViewShort(short, Number(session.sub), session.role === "admin")) {
    return new NextResponse("Not found", { status: 404 });
  }
  if (!(await canAccessChannel(short.channel))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const filePath = posterPathFor(short.channel, short.poster_key);
  if (!fs.existsSync(filePath)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const stat = fs.statSync(filePath);
  const etag = `"${short.poster_key}-${stat.size}-${Math.floor(stat.mtimeMs)}"`;
  const headers = {
    ETag: etag,
    "Cache-Control": "private, no-cache",
    "X-Content-Type-Options": "nosniff",
  };
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers });
  }

  const stream = fs.createReadStream(filePath);
  return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
    headers: {
      ...headers,
      "Content-Type": "image/jpeg",
      "Content-Length": String(stat.size),
      "Content-Disposition": "inline",
    },
  });
}

// Set a custom poster from a point in the video (admin only). Body: { time }
// in seconds — the frame the admin paused on while watching. The client should
// bust its cached poster URL (e.g. `?v=<now>`) after a success since the served
// URL is keyed by id, not by file.
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const short = getShort(Number(params.id));
  if (!short) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const time = Math.max(0, Number(body?.time) || 0);

  try {
    const newKey = await setCustomPoster(
      short.channel,
      short.storage_key,
      short.poster_key,
      time
    );
    db.prepare("UPDATE shorts SET poster_key = ? WHERE id = ?").run(
      newKey,
      short.id
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[shorts] set poster failed:", err);
    return NextResponse.json(
      { error: "Could not capture that frame." },
      { status: 500 }
    );
  }
}
