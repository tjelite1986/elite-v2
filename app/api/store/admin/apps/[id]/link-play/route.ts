import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { linkPlay, unlinkPlay } from "@/lib/sources/ingest";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Attach a Play Store package to an existing app for metadata + version-check.
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let packageId = "";
  let refreshMeta = false;
  try {
    const json = await request.json();
    packageId = json?.packageId || "";
    refreshMeta = !!json?.refreshMeta;
  } catch {
    /* ignore */
  }
  if (!packageId.trim()) {
    return NextResponse.json({ error: "Package id is required" }, { status: 400 });
  }
  try {
    const result = await linkPlay(Number(params.id), packageId, { refreshMeta });
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
  unlinkPlay(Number(params.id));
  return NextResponse.json({ ok: true });
}
