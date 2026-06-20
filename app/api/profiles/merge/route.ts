import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { mergeProfiles } from "@/lib/profile-merge";

export const dynamic = "force-dynamic";

// Merge a mirrored profile into another (admin only). Body:
//   { targetHandle, sourceHandle, newName? }
// targetHandle survives; sourceHandle's content is re-pointed into it; an
// optional newName renames the result.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const targetHandle = String(body?.targetHandle || "");
  const sourceHandle = String(body?.sourceHandle || "");
  const newName = typeof body?.newName === "string" ? body.newName : undefined;
  if (!targetHandle || !sourceHandle) {
    return NextResponse.json({ error: "Two profiles are required." }, { status: 400 });
  }

  try {
    const res = mergeProfiles({ targetHandle, sourceHandle, newName });
    return NextResponse.json({ ok: true, handle: res.handle });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Merge failed." },
      { status: 400 }
    );
  }
}
