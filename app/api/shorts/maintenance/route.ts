import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { parseChannel } from "@/lib/shorts";
import {
  findOrphanShorts,
  cleanupOrphanShorts,
  findEmptyPlaylists,
  purgeEmptyPlaylists,
} from "@/lib/shorts-maintenance";

export const dynamic = "force-dynamic";

// Admin maintenance for the shorts library. GET returns a scan report (clips
// whose file is missing + playlists with no visible clip). POST performs a
// cleanup: { action: "orphans" } soft-deletes the missing-file clips and detaches
// them from playlists; { action: "playlists" } removes the empty playlists.
// Optional ?channel=main|18plus scopes the orphan scan/cleanup to one section;
// empty playlists are not channel-bound, so they're always reported in full.

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const param = new URL(request.url).searchParams.get("channel");
  const channel = param ? parseChannel(param) : undefined;

  return NextResponse.json({
    orphans: findOrphanShorts(channel),
    emptyPlaylists: findEmptyPlaylists(),
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
  // host timer, which can't easily pass JSON through systemd's shell quoting).
  const action = body.action ?? url.searchParams.get("action");
  const param = url.searchParams.get("channel");
  const channel = param ? parseChannel(param) : undefined;

  // Orphan cleanup rescans now so we only ever remove rows whose file is
  // genuinely missing at delete time (not whatever the client last saw).
  const runOrphans = () =>
    cleanupOrphanShorts(findOrphanShorts(channel).map((o) => o.id)).deleted;

  if (action === "playlists") {
    return NextResponse.json({ ok: true, deleted: purgeEmptyPlaylists().deleted });
  }

  // "all" (used by the host timer): clean every channel's missing-file clips and
  // then the playlists they emptied, in one pass. No channel filter, so it spans
  // all profiles, uploaders and both channels.
  if (action === "all") {
    const orphans = runOrphans();
    const playlists = purgeEmptyPlaylists().deleted;
    return NextResponse.json({ ok: true, orphans, playlists });
  }

  // Default: orphans only.
  return NextResponse.json({ ok: true, deleted: runOrphans() });
}
