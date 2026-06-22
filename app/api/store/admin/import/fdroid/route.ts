import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ingestFdroid } from "@/lib/sources/ingest";
import { qb, getOne } from "@/lib/kysely";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let packageId = "";
  try {
    packageId = (await request.json())?.packageId || "";
  } catch {
    /* ignore */
  }
  if (!packageId.trim()) {
    return NextResponse.json({ error: "Package id is required" }, { status: 400 });
  }
  try {
    const appId = await ingestFdroid(packageId);
    const app = getOne<{ slug: string; name: string }>(
      qb.selectFrom("apps").select(["slug", "name"]).where("id", "=", appId)
    );
    return NextResponse.json({ ok: true, id: appId, ...app });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Import failed" },
      { status: 400 }
    );
  }
}
