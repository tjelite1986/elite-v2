import { NextResponse } from "next/server";
import fs from "node:fs";
import { Readable } from "node:stream";
import { getSession } from "@/lib/auth";
import { has18Access } from "@/lib/shorts-gate";
import { getAppRow, getDownloadVersion, markOpened } from "@/lib/store";
import { resolveAppFile } from "@/lib/appstore-storage";

export const dynamic = "force-dynamic";

// Stream the APK for an app (current version, or ?version=<id>). Auth + 18+ gate
// enforced; the raw archive path is never exposed.
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const app = getAppRow(Number(params.id));
  if (!app || !app.enabled) return new NextResponse("Not found", { status: 404 });
  if (app.requires_pin && !(await has18Access())) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  const versionId = Number(url.searchParams.get("version")) || undefined;
  const version = getDownloadVersion(app.id, versionId);
  if (!version) return new NextResponse("Not found", { status: 404 });

  const abs = resolveAppFile(app.source, version.apk_key);
  if (!abs) return new NextResponse("Not found", { status: 404 });

  // Record that the user opened/downloaded the app (best effort).
  try {
    markOpened(Number(session.sub), app.id);
  } catch {
    /* ignore */
  }

  const stat = fs.statSync(abs);
  const fileName = version.file_name || `${app.slug}-${version.version}.apk`;
  const stream = Readable.toWeb(
    fs.createReadStream(abs)
  ) as unknown as ReadableStream;

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
