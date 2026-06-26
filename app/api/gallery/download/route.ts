import { NextResponse } from "next/server";
import fs from "node:fs";
import { Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { GalleryItemRow } from "@/lib/db";
import { qb, getAll } from "@/lib/kysely";
import { getSession } from "@/lib/auth";
import { originalPathFor } from "@/lib/gallery-storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// Stream the selected (owned) items as a .zip of their originals.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = Number(session.sub);
  const body = await request.json().catch(() => ({}));
  const ids: number[] = Array.isArray(body.ids)
    ? body.ids.map((n: unknown) => Number(n)).filter((n: number) => Number.isInteger(n))
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "No items selected." }, { status: 400 });
  }

  const owned = getAll<Pick<GalleryItemRow, "id" | "storage_key" | "filename">>(
    qb
      .selectFrom("gallery_items")
      .select(["id", "storage_key", "filename"])
      .where("user_id", "=", userId)
      .where("is_deleted", "=", 0)
      .where("id", "in", ids)
  );
  if (owned.length === 0) {
    return NextResponse.json({ error: "Nothing to download." }, { status: 404 });
  }

  const archive = new ZipArchive({ store: true }); // already-compressed media
  const used = new Set<string>();
  for (const it of owned) {
    const path = originalPathFor(userId, it.storage_key);
    if (!fs.existsSync(path)) continue;
    // De-duplicate names so colliding filenames don't overwrite in the zip.
    let name = (it.filename || `photo-${it.id}`).replace(/[/\\]/g, "_");
    if (used.has(name)) name = `${it.id}-${name}`;
    used.add(name);
    archive.file(path, { name });
  }
  archive.finalize();

  return new NextResponse(Readable.toWeb(archive) as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="elite-photos-${Date.now()}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
