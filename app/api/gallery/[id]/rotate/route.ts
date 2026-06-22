import { NextResponse } from "next/server";
import fs from "node:fs";
import { db, GalleryItemRow } from "@/lib/db";
import { qb, getOne } from "@/lib/kysely";
import { getSession } from "@/lib/auth";
import {
  originalPathFor,
  thumbPathFor,
  previewPathFor,
  isHeic,
  heicToJpeg,
  regenerateDerivatives,
} from "@/lib/gallery-storage";

export const dynamic = "force-dynamic";

// Rotate an item 90° and regenerate its thumb/preview. The rotation is stored
// cumulatively and re-applied from the original each time (no quality drift),
// and media_version is bumped so cached <img> URLs refetch.
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = Number(session.sub);

  const item = getOne<GalleryItemRow>(
    qb
      .selectFrom("gallery_items")
      .selectAll()
      .where("id", "=", Number(params.id))
      .where("user_id", "=", userId)
  );
  if (!item) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const delta = body.dir === "ccw" ? 270 : 90;
  const rotation = (item.rotation + delta) % 360;

  const original = originalPathFor(userId, item.storage_key);
  if (!fs.existsSync(original)) {
    return NextResponse.json({ error: "Original missing." }, { status: 404 });
  }

  const heic = isHeic(item.filename, item.mime_type);
  let processBuffer: Buffer = fs.readFileSync(original);
  if (heic) processBuffer = heicToJpeg(processBuffer);

  const { width, height } = await regenerateDerivatives(
    {
      thumbPath: thumbPathFor(userId, item.storage_key),
      previewPath: previewPathFor(userId, item.storage_key),
    },
    processBuffer,
    { autoOrient: !heic, rotation }
  );

  const version = item.media_version + 1;
  db.prepare(
    "UPDATE gallery_items SET rotation = ?, media_version = ?, width = ?, height = ? WHERE id = ? AND user_id = ?"
  ).run(rotation, version, width, height, item.id, userId);

  return NextResponse.json({ ok: true, rotation, media_version: version });
}
