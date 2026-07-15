import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { runAppstoreImport } from "@/lib/appstore-import";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Admin session OR the import-cron shared secret (so the background job /
// host timer can trigger a scan).
async function authorize(request: Request): Promise<boolean> {
  const secret = process.env.IMPORT_CRON_SECRET;
  if (secret && request.headers.get("x-import-secret") === secret) return true;
  const session = await getSession();
  return !!session && session.role === "admin";
}

export async function POST(request: Request) {
  if (!(await authorize(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const summary = await runAppstoreImport();
  return NextResponse.json({ ok: true, ...summary });
}
