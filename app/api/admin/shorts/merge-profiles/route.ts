import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { mergeShortProfiles } from "@/lib/shorts";

export const dynamic = "force-dynamic";

// Merge several short_profiles (same model, different handles) into one primary:
// reassigns their clips, records aliases, deletes the merged rows. Admin only.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const primaryId = Number(body?.primaryId);
  const mergeIds = Array.isArray(body?.mergeIds)
    ? body.mergeIds.map(Number).filter(Number.isInteger)
    : [];
  if (!Number.isInteger(primaryId) || mergeIds.length === 0) {
    return NextResponse.json(
      { error: "primaryId and a non-empty mergeIds[] are required." },
      { status: 400 }
    );
  }
  try {
    const result = mergeShortProfiles(primaryId, mergeIds);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
