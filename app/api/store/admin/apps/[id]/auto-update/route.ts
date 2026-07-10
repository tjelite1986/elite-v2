import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { setAutoUpdate } from "@/lib/sources/updater";

export const dynamic = "force-dynamic";

export async function PUT(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let enabled = false;
  try {
    enabled = !!(await request.json())?.enabled;
  } catch {
    /* ignore */
  }
  setAutoUpdate(Number(params.id), enabled);
  return NextResponse.json({ ok: true, enabled });
}
