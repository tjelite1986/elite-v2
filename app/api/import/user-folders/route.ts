import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { runUserFolderImport } from "@/lib/user-import";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Scan every user's per-user `_import` drop tree and import each section
// (shorts/main, shorts/18plus, posts, gallery) with the dropping user as owner.
// Authorized either by an admin session (the "Import now" button) or by the
// host timer presenting the shared IMPORT_CRON_SECRET, so a single code path
// serves both. Optional body { user } limits the run to one account.
export async function POST(request: Request) {
  const session = await getSession();
  const secret = process.env.IMPORT_CRON_SECRET;
  const presented = request.headers.get("x-import-secret");
  const isAdmin = session?.role === "admin";
  const isCron = Boolean(secret) && presented === secret;

  if (!isAdmin && !isCron) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const onlyUser =
    typeof body?.user === "string" && body.user.trim() ? body.user.trim() : undefined;

  try {
    const summary = await runUserFolderImport({ onlyUser });
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("[user-import] failed:", err);
    return NextResponse.json({ error: "Import failed." }, { status: 500 });
  }
}
