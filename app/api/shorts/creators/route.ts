import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canAccessChannel, getCreators, parseChannel } from "@/lib/shorts";

export const dynamic = "force-dynamic";

// Profiles with at least one ready clip, for the Profiles grid. Channel-gated.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const channel = parseChannel(new URL(request.url).searchParams.get("channel"));
  if (!(await canAccessChannel(channel))) {
    return NextResponse.json({ error: "Locked" }, { status: 403 });
  }
  return NextResponse.json({ creators: getCreators(channel) });
}
