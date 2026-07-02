import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Scan the posts import folder and sort dropped images into creator profiles
// (admin only). Runs the same scripts/import-posts.mjs the host timer uses.
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session, "posts_settings")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const script = path.join(process.cwd(), "scripts", "import-posts.mjs");
  try {
    // Async exec — a synchronous run here would freeze the whole single-process
    // server for the duration of the import.
    const { stdout: out } = await execFileAsync(process.execPath, [script], {
      encoding: "utf8",
      timeout: 110_000,
      cwd: process.cwd(),
    });
    const line = out
      .split("\n")
      .reverse()
      .find((l) => l.startsWith("RESULT "));
    const summary = line
      ? JSON.parse(line.slice("RESULT ".length))
      : { imported: 0, creatorsNew: 0, videosRouted: 0, deduped: 0, skipped: 0 };
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("[posts] import failed:", err);
    return NextResponse.json({ error: "Import failed." }, { status: 500 });
  }
}
