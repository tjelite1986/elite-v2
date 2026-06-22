import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { checkApp } from "@/lib/sources/updater";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const result = await checkApp(Number(params.id));
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Check failed" },
      { status: 400 }
    );
  }
}
