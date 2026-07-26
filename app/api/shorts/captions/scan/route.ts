import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import { getSession } from "@/lib/auth";
import { db, ShortCaptionStateRow } from "@/lib/db";
import { qb, getOne } from "@/lib/kysely";
import { parseChannel } from "@/lib/shorts";

export const dynamic = "force-dynamic";

// Start the caption backfill (admin only): clips whose caption holds nothing
// but a source link get that page's real title and tags, re-read via grabbit.
// One network round-trip per source, so it runs detached like the title fetch
// and reports through short_caption_state.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const current = getOne<Pick<ShortCaptionStateRow, "status">>(
    qb.selectFrom("short_caption_state").select("status").where("id", "=", 1)
  );
  if (current?.status === "running") {
    return NextResponse.json({ ok: true, alreadyRunning: true });
  }

  const channelParam = new URL(request.url).searchParams.get("channel");
  const channel = channelParam ? parseChannel(channelParam) : null;

  // Flip the beacon synchronously so a second click can't double-launch.
  db.prepare(
    `INSERT INTO short_caption_state (id, status, started_at, finished_at, processed, updated, total, message)
     VALUES (1, 'running', datetime('now'), NULL, 0, 0, 0, NULL)
     ON CONFLICT(id) DO UPDATE SET
       status='running', started_at=datetime('now'), finished_at=NULL,
       processed=0, updated=0, total=0, message=NULL`
  ).run();

  const script = path.join(
    process.cwd(),
    "scripts",
    "backfill-shorts-captions.mjs"
  );
  const args = [script];
  if (channel) args.push(channel);
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();

  return NextResponse.json({ ok: true, started: true });
}
