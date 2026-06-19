import { NextResponse } from "next/server";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Scan a channel's import folder and sort any dropped files into profiles (admin
// only). Runs the same scripts/import-shorts.mjs the host timer uses, so there's
// a single implementation. The channel comes from the request body (defaults to
// 18plus for backward compatibility) and is forwarded as IMPORT_CHANNEL.
// Returns a count summary parsed from its RESULT line.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const channel = body?.channel === "main" ? "main" : "18plus";

  const script = path.join(process.cwd(), "scripts", "import-shorts.mjs");
  try {
    const out = execFileSync(process.execPath, [script], {
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
