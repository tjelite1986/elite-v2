import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { setUsername, setProfileFields, getProfileByUserId } from "@/lib/profiles";

export const dynamic = "force-dynamic";

// GET — list user profiles for the rename picker (admin only).
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const profiles = db
    .prepare(
      `SELECT user_id, username, display_name FROM user_profiles ORDER BY username`
    )
    .all() as { user_id: number; username: string; display_name: string | null }[];
  return NextResponse.json({ profiles });
}

// POST { userId, username?, display_name? } — rename a user profile's handle
// and/or display name (admin only). The handle is validated + uniqueness-checked
// by setUsername.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const userId = Number(body?.userId);
  if (!Number.isInteger(userId) || !getProfileByUserId(userId)) {
    return NextResponse.json({ error: "Unknown profile." }, { status: 404 });
  }

  if (typeof body?.username === "string" && body.username.trim()) {
    const err = setUsername(userId, body.username);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }
  if (typeof body?.display_name === "string") {
    setProfileFields(userId, { display_name: body.display_name.trim() || null });
  }
  return NextResponse.json({ ok: true, profile: getProfileByUserId(userId) });
}
