import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { getSession } from "@/lib/auth";
import { hasShortsPermission } from "@/lib/permissions";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Scan a channel's import folder and sort any dropped files into profiles. Runs
// the same scripts/import-shorts.mjs the host timer uses, so there's a single
// implementation. The channel comes from the request body (defaults to 18plus
// for backward compatibility) and is forwarded as IMPORT_CHANNEL. Returns a
// count summary parsed from its RESULT line. Runs the script asynchronously —
// a synchronous exec here would freeze the whole single-process server for the
// duration of the import.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const channel = body?.channel === "main" ? "main" : "18plus";
  if (!hasShortsPermission(session, channel)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const script = path.join(process.cwd(), "scripts", "import-shorts.mjs");
  try {
    const { stdout: out } = await execFileAsync(process.execPath, [script], {
      encoding: "utf8",
      timeout: 110_000,
      cwd: process.cwd(),
      env: { ...process.env, IMPORT_CHANNEL: channel },
    });
    const line = out
      .split("\n")
      .reverse()
      .find((l) => l.startsWith("RESULT "));
    const summary = line
      ? JSON.parse(line.slice("RESULT ".length))
      : { imported: 0, profilesNew: 0, skipped: 0 };
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("[shorts] import failed:", err);
    return NextResponse.json({ error: "Import failed." }, { status: 500 });
  }
}
