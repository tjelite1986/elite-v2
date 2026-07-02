import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { getGalleryDupeState } from "@/lib/gallery-duplicates";

export const dynamic = "force-dynamic";

// Treat a 'running' row older than an hour as stale: the detached scanner was
// killed (docker restart / SIGKILL) without writing a final status, and without
// this check the scan could never be restarted.
const SCAN_STALE_MS = 60 * 60 * 1000;
function staleRunning(startedAt: string | null): boolean {
  if (!startedAt) return true;
  const t = new Date(startedAt.replace(" ", "T") + "Z").getTime();
  return !Number.isFinite(t) || Date.now() - t > SCAN_STALE_MS;
}

// Kick off a full duplicate scan of the gallery library (admin only). The scan
// can take minutes over a large library, so it runs detached: this route just
// launches scripts/scan-gallery-duplicates.mjs in the background and returns
// immediately. The script writes its progress to gallery_dupe_state, which the
// UI polls and GET /api/gallery/duplicates reads.
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session, "gallery_settings")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const state = getGalleryDupeState();
  if (state.status === "running" && !staleRunning(state.started_at)) {
    return NextResponse.json({ ok: true, alreadyRunning: true });
  }

  // Flip the beacon synchronously so a second click can't double-launch before
  // the detached process gets a chance to write its own 'running' row.
  db.prepare(
    `INSERT INTO gallery_dupe_state (id, status, started_at, finished_at, scanned, groups, message)
     VALUES (1, 'running', datetime('now'), NULL, 0, 0, NULL)
     ON CONFLICT(id) DO UPDATE SET
       status = 'running', started_at = datetime('now'), finished_at = NULL,
       scanned = 0, groups = 0, message = NULL`
  ).run();

  const script = path.join(process.cwd(), "scripts", "scan-gallery-duplicates.mjs");
  const child = spawn(process.execPath, [script], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();

  return NextResponse.json({ ok: true, started: true });
}
