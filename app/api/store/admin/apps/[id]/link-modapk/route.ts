import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { linkModApk, unlinkModApk } from "@/lib/sources/ingest";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Attach a latestmodapks.com page to an existing app (metadata + banner +
// version-check). Scraped via curl-impersonate.
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let url = "";
  let refreshMeta = true;
  try {
    const json = await request.json();
    url = json?.url || "";
    refreshMeta = json?.refreshMeta !== false;
  } catch {
    /* ignore */
  }
  if (!url.trim()) {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }
  try {
    const result = await linkModApk(Number(params.id), url, { refreshMeta });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Link failed" },
      { status: 400 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  unlinkModApk(Number(params.id));
  return NextResponse.json({ ok: true });
}
