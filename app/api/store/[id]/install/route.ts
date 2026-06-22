import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { has18Access } from "@/lib/shorts-gate";
import { getAppRow, installApp, uninstallApp, canAccessApp } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function PUT(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const app = getAppRow(Number(params.id));
  if (!app) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canAccessApp(app, await has18Access())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  installApp(Number(session.sub), app.id);
  return NextResponse.json({ ok: true, installed: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const app = getAppRow(Number(params.id));
  if (!app) return NextResponse.json({ error: "Not found" }, { status: 404 });

  uninstallApp(Number(session.sub), app.id);
  return NextResponse.json({ ok: true, installed: false });
}
