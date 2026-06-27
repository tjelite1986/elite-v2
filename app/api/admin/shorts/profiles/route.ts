import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listProfilesForMerge, parseChannel } from "@/lib/shorts";

export const dynamic = "force-dynamic";

// All short_profiles on a channel (with clip counts), for the admin merge picker.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const channel = parseChannel(new URL(request.url).searchParams.get("channel"));
  return NextResponse.json({ profiles: listProfilesForMerge(channel) });
}
