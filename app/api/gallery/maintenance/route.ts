import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  findOrphanGalleryItems,
  cleanupOrphanGalleryItems,
} from "@/lib/gallery-maintenance";

export const dynamic = "force-dynamic";

// Admin maintenance for the gallery library, mirroring /api/posts/maintenance.
// GET returns a scan report (items whose original file is missing). POST
// performs a cleanup: { action: "orphans" } (default) or { action: "all" } both
// drop the missing-file item rows — the gallery has no parent "post", so there's
// no empty-parent half.

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    orphans: findOrphanGalleryItems(),
  });
}

export async function POST(request: Request) {
  // Authorized either by an admin session (the Settings buttons) or by the host
  // timer presenting the shared IMPORT_CRON_SECRET, so one code path serves both.
  const session = await getSession();
  const secret = process.env.IMPORT_CRON_SECRET;
  const presented = request.headers.get("x-import-secret");
  const isAdmin = session?.role === "admin";
  const isCron = Boolean(secret) && presented === secret;
  if (!isAdmin && !isCron) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const body = await request.json().catch(() => ({}));
  // action accepted in the JSON body (Settings buttons) or the query string (the
  // job scheduler, which posts ?action=all).
  const action = body.action ?? url.searchParams.get("action");

  // Orphan cleanup rescans now so we only ever remove rows whose file is
  // genuinely missing at delete time (not whatever the client last saw).
  const runOrphans = () =>
    cleanupOrphanGalleryItems(findOrphanGalleryItems().map((o) => o.id)).deleted;

  // "all" (used by the job scheduler): same as orphans for the gallery, kept as a
  // distinct action so the cron path mirrors the posts/shorts maintenance shape.
  if (action === "all") {
    return NextResponse.json({ ok: true, orphans: runOrphans() });
  }

  // Default: orphans only.
  return NextResponse.json({ ok: true, deleted: runOrphans() });
}
