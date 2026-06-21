import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPostDupeGroups, getPostDupeState } from "@/lib/posts-duplicates";

export const dynamic = "force-dynamic";

// Latest duplicate-scan results + scan progress for the posts library (admin
// only).
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    state: getPostDupeState(),
    groups: getPostDupeGroups(),
  });
}
