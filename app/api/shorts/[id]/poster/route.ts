import { NextResponse } from "next/server";
import fs from "node:fs";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { canAccessChannel, canViewShort, getShort } from "@/lib/shorts";
import { posterPathFor, setCustomPoster } from "@/lib/shorts-storage";

export const dynamic = "force-dynamic";

// Serve a short's poster (JPEG). Same gate enforcement as the video route.
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
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

  return new NextResponse(fs.readFileSync(filePath), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=86400",
    },
  });
}

// Set a custom poster from a point in the video (admin only). Body: { time }
// in seconds — the frame the admin paused on while watching. The client should
// bust its cached poster URL (e.g. `?v=<now>`) after a success since the served
// URL is keyed by id, not by file.
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
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
