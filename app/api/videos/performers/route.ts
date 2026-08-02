import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canAccessVideoChannel } from "@/lib/videos";
import { listPerformers } from "@/lib/video-performers";

export const dynamic = "force-dynamic";

// Performers are an 18+ library concept, so the gate applies to the list too.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await canAccessVideoChannel("adults"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ performers: listPerformers() });
}
