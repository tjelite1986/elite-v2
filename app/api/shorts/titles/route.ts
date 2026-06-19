import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db, ShortTitleStateRow } from "@/lib/db";

export const dynamic = "force-dynamic";

// Progress of the bulk title-fetch job (admin only).
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const state =
    (db
      .prepare("SELECT * FROM short_title_state WHERE id = 1")
      .get() as ShortTitleStateRow | undefined) ?? {
      id: 1,
      status: "idle" as const,
      started_at: null,
      finished_at: null,
      processed: 0,
      updated: 0,
      total: 0,
      message: null,
    };

  return NextResponse.json({ state });
}
