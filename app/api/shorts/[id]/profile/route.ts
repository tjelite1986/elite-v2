import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db, ShortProfileRow } from "@/lib/db";
import { qb, getOne } from "@/lib/kysely";
import { getShort } from "@/lib/shorts";
import { moveShortToProfile } from "@/lib/shorts-storage";

export const dynamic = "force-dynamic";

// Reassign a clip to a different profile (admin only). Used to fix imports that
// landed under the wrong/fallback profile. The target profile must exist and
// live on the same channel as the clip — clips never cross between main and 18+.
// Moves the files into the new profile folder, then persists the new keys.
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
  const profileId = Number(body?.profileId);
  if (!Number.isInteger(profileId) || profileId <= 0) {
    return NextResponse.json({ error: "Invalid profile." }, { status: 400 });
  }
  if (profileId === short.profile_id) {
    return NextResponse.json({ ok: true, profile_id: profileId });
  }

  const profile = getOne<ShortProfileRow>(
    qb.selectFrom("short_profiles").selectAll().where("id", "=", profileId)
  );
  if (!profile) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }
  if (profile.channel !== short.channel) {
    return NextResponse.json(
      { error: "Profile is on a different channel." },
      { status: 400 }
    );
  }

  try {
    const moved = moveShortToProfile(
      short.channel,
      short.storage_key,
      short.poster_key,
      profile.name
    );
    db.prepare(
      "UPDATE shorts SET profile_id = ?, storage_key = ?, poster_key = ? WHERE id = ?"
    ).run(profile.id, moved.storageKey, moved.posterKey, short.id);
  } catch (err) {
    console.error("[shorts] profile reassign failed:", err);
    return NextResponse.json({ error: "Reassign failed." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    profile_id: profile.id,
    profile_name: profile.name,
  });
}
