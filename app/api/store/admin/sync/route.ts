import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { syncArchiveCatalog } from "@/lib/appstore-sync";

export const dynamic = "force-dynamic";

// Rescan the on-disk archive and upsert the catalog. Admin-only. Curation flags
// and user data are preserved; versions/screenshots are rebuilt from disk.
export async function POST() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const result = syncArchiveCatalog(db);
  return NextResponse.json({ ok: true, ...result });
}
