import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import {
  findOrphanMedia,
  cleanupOrphanMedia,
  findEmptyPosts,
  purgeEmptyPosts,
} from "@/lib/posts-maintenance";

export const dynamic = "force-dynamic";

// Admin maintenance for the posts library, mirroring /api/shorts/maintenance.
// GET returns a scan report (images whose file is missing + posts with no
// viewable image). POST performs a cleanup: { action: "orphans" } drops the
// missing-file media rows; { action: "empty" } soft-deletes the empty posts.

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session, "posts_settings")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    orphans: findOrphanMedia(),
    emptyPosts: findEmptyPosts(),
  });
}

export async function POST(request: Request) {
  // Authorized either by an admin session (the Settings buttons) or by the host
  // timer presenting the shared IMPORT_CRON_SECRET, so one code path serves both.
  const session = await getSession();
  const secret = process.env.IMPORT_CRON_SECRET;
  const presented = request.headers.get("x-import-secret");
  const isAllowed = hasPermission(session, "posts_settings");
  const isCron = Boolean(secret) && presented === secret;
  if (!isAllowed && !isCron) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const body = await request.json().catch(() => ({}));
  // action accepted in the JSON body (Settings buttons) or the query string (the
  // host timer, which can't easily pass JSON through systemd's shell quoting).
  const action = body.action ?? url.searchParams.get("action");

  // Orphan cleanup rescans now so we only ever remove rows whose file is
  // genuinely missing at delete time (not whatever the client last saw).
  const runOrphans = () =>
    cleanupOrphanMedia(findOrphanMedia().map((o) => o.id)).deleted;

  if (action === "empty") {
    return NextResponse.json({ ok: true, deleted: purgeEmptyPosts().deleted });
  }

  // "all" (used by the host timer): drop every missing-file image and then the
  // posts they emptied, in one pass.
  if (action === "all") {
    const orphans = runOrphans();
    const empty = purgeEmptyPosts().deleted;
    return NextResponse.json({ ok: true, orphans, empty });
  }

  // Default: orphans only.
  return NextResponse.json({ ok: true, deleted: runOrphans() });
}
