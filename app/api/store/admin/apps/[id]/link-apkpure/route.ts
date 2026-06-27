import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { linkApkpure, unlinkApkpure } from "@/lib/sources/ingest";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Attach an APKPure app page to an existing app for metadata/icon/screenshots
// + version-check.
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let url = "";
  try {
    const json = await request.json();
    url = json?.url || "";
  } catch {
    /* ignore */
  }
  if (!url.trim()) {
    return NextResponse.json({ error: "APKPure URL is required" }, { status: 400 });
  }
  try {
    const result = await linkApkpure(Number(params.id), url, { refreshMeta: true });
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
  unlinkApkpure(Number(params.id));
  return NextResponse.json({ ok: true });
}
