import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { allTags } from "@/lib/gallery-tags";

export const dynamic = "force-dynamic";

// All of the current user's tags with item counts (for the sidebar).
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ tags: allTags(Number(session.sub)) });
}
