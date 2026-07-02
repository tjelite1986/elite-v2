import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasShortsPermission } from "@/lib/permissions";
import { parseChannel } from "@/lib/shorts";
import { getDupeGroups, getDupeState } from "@/lib/shorts-duplicates";

export const dynamic = "force-dynamic";

// Latest duplicate-scan results + scan progress (admin only). Optional
// ?channel=main|18plus narrows the groups to one section.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const param = new URL(request.url).searchParams.get("channel");
  const channel = param ? parseChannel(param) : undefined;
  if (!hasShortsPermission(session, channel)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    state: getDupeState(),
    groups: getDupeGroups(channel),
  });
}
