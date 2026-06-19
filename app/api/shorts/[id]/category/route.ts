import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { getShort } from "@/lib/shorts";
import { parseCategory } from "@/lib/shorts-categories";

export const dynamic = "force-dynamic";

// Set a clip's 18+ category bucket. Admin only — categorisation is a curation
// task, not something every viewer should change.
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const short = getShort(Number(params.id));
  if (!short) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const category = parseCategory(body?.category);
  if (!category) {
    return NextResponse.json({ error: "Invalid category." }, { status: 400 });
  }

  db.prepare("UPDATE shorts SET category = ? WHERE id = ?").run(category, short.id);
  return NextResponse.json({ ok: true, category });
}
