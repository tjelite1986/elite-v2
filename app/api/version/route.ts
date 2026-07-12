import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

let cached: string | null = null;

// Current build id. Installed PWAs poll this on resume to detect a new
// deployment and reload themselves (Android keeps the old app instance alive
// in memory indefinitely otherwise). Unauthenticated by design — it exposes
// nothing but an opaque build hash.
export async function GET() {
  if (!cached) {
    try {
      cached = readFileSync(
        path.join(process.cwd(), ".next", "BUILD_ID"),
        "utf8"
      ).trim();
    } catch {
      cached = "dev";
    }
  }
  return NextResponse.json({ build: cached });
}
