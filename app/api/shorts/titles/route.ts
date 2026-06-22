import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ShortTitleStateRow } from "@/lib/db";
import { qb, getOne } from "@/lib/kysely";

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
    getOne<ShortTitleStateRow>(
      qb.selectFrom("short_title_state").selectAll().where("id", "=", 1)
    ) ?? {
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
