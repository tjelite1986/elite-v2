import { NextResponse } from "next/server";
import fs from "node:fs";
import { db, ShortRow, ShortProfileRow } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { setHandleAvatar } from "@/lib/profiles";
import { handleOf } from "@/lib/directory";
import { posterPathFor } from "@/lib/shorts-storage";
import { storeAvatar } from "@/lib/posts-storage";

export const dynamic = "force-dynamic";

// Use a shorts/18+ clip's poster frame as a person's profile picture. The avatar
// belongs to the clip's person (the uploader for user uploads, else the clip's
// creator profile). Uploader sets their own; a creator's is admin-only.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = Number(session.sub);

  const body = await request.json().catch(() => ({}));
  const short = db
    .prepare("SELECT * FROM shorts WHERE id = ? AND is_deleted = 0")
    .get(Number(body?.shortId)) as ShortRow | undefined;
  if (!short) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!short.poster_key) {
    return NextResponse.json({ error: "This clip has no poster yet." }, { status: 400 });
  }

  // Resolve the owning handle + permission.
  let handle: string;
  if (short.uploader_id) {
    if (short.uploader_id !== userId && session.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const u = db
      .prepare("SELECT username FROM user_profiles WHERE user_id = ?")
      .get(short.uploader_id) as { username: string } | undefined;
    if (!u) return NextResponse.json({ error: "Not found" }, { status: 404 });
    handle = handleOf(u.username);
  } else if (short.profile_id) {
    if (session.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const p = db
      .prepare("SELECT * FROM short_profiles WHERE id = ?")
      .get(short.profile_id) as ShortProfileRow | undefined;
    if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
    handle = handleOf(p.name);
  } else {
    return NextResponse.json({ error: "Clip has no owner." }, { status: 400 });
  }

  const posterPath = posterPathFor(short.channel, short.poster_key);
  if (!fs.existsSync(posterPath)) {
    return NextResponse.json({ error: "Poster file missing." }, { status: 404 });
  }

  try {
    const buffer = fs.readFileSync(posterPath);
    const key = await storeAvatar(short.poster_key, "image/jpeg", buffer);
    setHandleAvatar(handle, key);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not set avatar." },
      { status: 400 }
    );
  }
}
