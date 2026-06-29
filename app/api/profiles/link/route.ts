import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  linkProfiles,
  unlinkProfile,
  listLinkGroups,
} from "@/lib/profile-links";

export const dynamic = "force-dynamic";

// Non-destructive profile links (admin only). Members keep their own rows and
// sync independently; the unified profile page + people directory show them as
// one under the primary "face".

// GET — list all link groups.
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ groups: listLinkGroups() });
}

// POST { primaryHandle, memberHandles: string[] } — link members under a face.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const primaryHandle = String(body?.primaryHandle || "");
  const memberHandles = Array.isArray(body?.memberHandles)
    ? body.memberHandles.map(String)
    : [];
  if (!primaryHandle || memberHandles.length === 0) {
    return NextResponse.json(
      { error: "A primary and at least one member are required." },
      { status: 400 }
    );
  }
  try {
    linkProfiles(primaryHandle, memberHandles);
    return NextResponse.json({ ok: true, groups: listLinkGroups() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Link failed." },
      { status: 400 }
    );
  }
}

// DELETE { memberHandle } — unlink a member (it becomes standalone again).
export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const memberHandle = String(body?.memberHandle || "");
  if (!memberHandle) {
    return NextResponse.json({ error: "A member is required." }, { status: 400 });
  }
  unlinkProfile(memberHandle);
  return NextResponse.json({ ok: true, groups: listLinkGroups() });
}
