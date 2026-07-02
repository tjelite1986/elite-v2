import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { ingestMedia } from "@/lib/gallery-ingest";

export const dynamic = "force-dynamic";

// Folder watched for imports — inside the gallery store so it's browsable in the
// same network share (Elitev2/gallery/import), like elite's /store/import.
const IMPORT_DIR = process.env.IMPORT_DIR || "/gallery-store/import";
const PROCESSED_DIR = path.join(IMPORT_DIR, ".processed");

const MEDIA_RE = /\.(jpe?g|png|webp|gif|avif|heic|heif|mp4|mov|m4v|webm|3gp|avi|mkv)$/i;

// Recursively collect media files under the import dir (skip .processed).
function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === ".processed") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && MEDIA_RE.test(e.name)) out.push(full);
  }
  return out;
}

// Import every image from the drop folder into the current user's gallery,
// reading GPS/date from the originals, then delete the source files.
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // The drop folder is SHARED — sweeping it claims every file in it for the
  // calling user's gallery, so gate it like the rest of the gallery settings.
  if (!hasPermission(session, "gallery_settings")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userId = Number(session.sub);

  if (!fs.existsSync(IMPORT_DIR)) {
    return NextResponse.json({
      ok: true,
      imported: 0,
      skipped: 0,
      note: "Import folder not found.",
    });
  }

  const files = walk(IMPORT_DIR);
  let imported = 0;
  let skipped = 0;

  for (const file of files) {
    try {
      let mtime: number | null = null;
      try {
        mtime = fs.statSync(file).mtimeMs;
      } catch {
        /* ignore */
      }
      // Pass the source PATH — videos are copied instead of buffered in memory.
      const id = await ingestMedia(userId, path.basename(file), "", file, mtime);
      if (id) {
        imported++;
        // Move the source into .processed (non-destructive) instead of deleting,
        // mirroring elite — the photo is already stored under originals/.
        try {
          fs.mkdirSync(PROCESSED_DIR, { recursive: true });
          fs.renameSync(file, path.join(PROCESSED_DIR, path.basename(file)));
        } catch {
          /* leave the file in place if it can't be moved */
        }
      } else {
        skipped++;
      }
    } catch (err) {
      console.error(`[gallery] import failed for ${file}:`, err);
      skipped++;
    }
  }

  return NextResponse.json({ ok: true, imported, skipped });
}
