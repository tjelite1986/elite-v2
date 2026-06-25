import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { qb, getOne } from "@/lib/kysely";
import { canAccessChannel, parseChannel } from "@/lib/shorts";
import {
  storeShortUpload,
  userHomeDir,
  profileFromFilename,
} from "@/lib/shorts-storage";
import { getExt } from "@/lib/gallery-storage";

export const dynamic = "force-dynamic";

// Formats browsers can play as-is, so the clip is shown immediately and the
// transcoder (v1b) only optimizes it later. Everything else stays 'pending'
// until transcoded to .web.mp4 so the feed never serves an unplayable file.
const WEB_PLAYABLE = new Set(["mp4", "m4v", "webm"]);

// Upload one short. Uploading to the 18+ channel requires an unlocked gate, so
// you can't seed that channel without the PIN.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = Number(session.sub);

  const form = await request.formData();
  const file = form.get("file");
  const channel = parseChannel(String(form.get("channel") || "main"));
  const caption = String(form.get("caption") || "").trim().slice(0, 2000);
  // New uploads are PRIVATE by default — only "public" shares to everyone.
  const isPrivate = String(form.get("visibility") || "private") === "public" ? 0 : 1;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  }
  if (!(await canAccessChannel(channel))) {
    return NextResponse.json({ error: "Locked" }, { status: 403 });
  }

  try {
    // Each user's clips live under their own home dir
    // (<PROFILE_ROOT>/u_<user>/shorts/<channel>/), with a readable filename.
    const me = getOne<{ username: string }>(
      qb.selectFrom("user_profiles").select("username").where("user_id", "=", userId)
    );
    const buffer = Buffer.from(await file.arrayBuffer());
    // A "profilname_-_title.mp4" filename lands in that creator's subfolder;
    // anything else falls back to a shared folder inside storeShortUpload, so a
    // clip is never stored loose in the channel root.
    const subdir = profileFromFilename(file.name) ?? undefined;
    const stored = await storeShortUpload(
      channel,
      userHomeDir(userId, me?.username),
      caption,
      file.name,
      file.type,
      buffer,
      subdir
    );

    const status = WEB_PLAYABLE.has(getExt(file.name)) ? "ready" : "pending";

    const result = db
      .prepare(
        `INSERT INTO shorts
           (channel, uploader_id, caption, storage_key, poster_key, mime_type,
            width, height, duration, size_bytes, source, status, is_private)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'upload', ?, ?)`
      )
      .run(
        channel,
        userId,
        caption || null,
        stored.storageKey,
        stored.posterKey,
        stored.mimeType,
        stored.width,
        stored.height,
        stored.duration,
        stored.sizeBytes,
        status,
        isPrivate
      );

    return NextResponse.json({ ok: true, id: Number(result.lastInsertRowid) });
  } catch (err) {
    console.error("[shorts] upload failed:", err);
    const message =
      err instanceof Error ? err.message : "Failed to process upload";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
