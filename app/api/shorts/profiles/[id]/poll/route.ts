import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ShortProfileRow } from "@/lib/db";
import { qb, getOne } from "@/lib/kysely";
import { triggerPoll } from "@/lib/shorts-poll";

export const dynamic = "force-dynamic";

// Kick off an on-demand poll of a single profile (admin only). Returns
// immediately; the download runs in the background and the admin UI refreshes
// to show new clips appearing.
export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const profile = getOne<Pick<ShortProfileRow, "id">>(
    qb.selectFrom("short_profiles").select("id").where("id", "=", Number(params.id))
  );
  if (!profile) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  triggerPoll(profile.id);
  return NextResponse.json({ ok: true });
}
