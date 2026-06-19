import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import { getSession } from "@/lib/auth";
import { db, ShortTitleStateRow } from "@/lib/db";
import { parseChannel } from "@/lib/shorts";

export const dynamic = "force-dynamic";

// Start a bulk original-title fetch (admin only). Can take many minutes over a
// large library (one yt-dlp call per clip), so it runs detached: this route
// launches scripts/fetch-shorts-titles.mjs in the background and returns
// immediately. Progress is written to short_title_state, which the UI polls.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const current = db
    .prepare("SELECT status FROM short_title_state WHERE id = 1")
    .get() as Pick<ShortTitleStateRow, "status"> | undefined;
  if (current?.status === "running") {
    return NextResponse.json({ ok: true, alreadyRunning: true });
  }

  const param = new URL(request.url).searchParams.get("channel");
  const channel = param ? parseChannel(param) : null;

  // Flip the beacon synchronously so a second click can't double-launch.
  db.prepare(
    `INSERT INTO short_title_state (id, status, started_at, finished_at, processed, updated, total, message)
     VALUES (1, 'running', datetime('now'), NULL, 0, 0, 0, NULL)
     ON CONFLICT(id) DO UPDATE SET
       status='running', started_at=datetime('now'), finished_at=NULL,
       processed=0, updated=0, total=0, message=NULL`
  ).run();

  const script = path.join(process.cwd(), "scripts", "fetch-shorts-titles.mjs");
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
