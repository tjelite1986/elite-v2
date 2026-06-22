import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { updateNow } from "@/lib/sources/updater";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const result = await updateNow(Number(params.id));
    if (!result) {
      return NextResponse.json({ error: "Nothing to download" }, { status: 400 });
    }
    return NextResponse.json({ ok: result.status === "ok" || result.status === "unverifiable", ...result });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Update failed" },
      { status: 400 }
    );
  }
}
