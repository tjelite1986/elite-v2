import { NextResponse } from "next/server";
import fs from "node:fs";
import { ShortRow, ShortProfileRow } from "@/lib/db";
import { qb, getOne } from "@/lib/kysely";
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
  const short = getOne<ShortRow>(
    qb.selectFrom("shorts").selectAll().where("id", "=", Number(body?.shortId)).where("is_deleted", "=", 0)
  );
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
    const u = getOne<{ username: string }>(
      qb.selectFrom("user_profiles").select("username").where("user_id", "=", short.uploader_id)
    );
    if (!u) return NextResponse.json({ error: "Not found" }, { status: 404 });
    handle = handleOf(u.username);
  } else if (short.profile_id) {
    if (session.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const p = getOne<ShortProfileRow>(
      qb.selectFrom("short_profiles").selectAll().where("id", "=", short.profile_id)
    );
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
