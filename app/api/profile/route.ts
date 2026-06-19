import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  ensureUserProfile,
  setUsername,
  setProfileFields,
  getProfileByUserId,
} from "@/lib/profiles";

export const dynamic = "force-dynamic";

// The current user's public profile.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const profile = ensureUserProfile(Number(session.sub), session.email);
  return NextResponse.json({ profile });
}

// Update username / display name / bio.
export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = Number(session.sub);
  ensureUserProfile(userId, session.email);

  const body = await request.json().catch(() => ({}));

  if (typeof body?.username === "string" && body.username.trim()) {
    const err = setUsername(userId, body.username);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }

  const fields: { display_name?: string | null; bio?: string | null } = {};
  if (typeof body?.display_name === "string") fields.display_name = body.display_name.trim();
  if (typeof body?.bio === "string") fields.bio = body.bio.trim();
  setProfileFields(userId, fields);

  return NextResponse.json({ ok: true, profile: getProfileByUserId(userId) });
}
