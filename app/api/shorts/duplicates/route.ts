import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasShortsPermission } from "@/lib/permissions";
import { parseChannel } from "@/lib/shorts";
import {
  dismissDupeGroup,
  getDupeGroups,
  getDupeState,
} from "@/lib/shorts-duplicates";

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

/**
 * Mark a group as "not duplicates". The scan rewrites its table on every run,
 * so the judgement is recorded separately and applied when groups are read —
 * otherwise a wrong match reappears after the next scan, and the reviewer has
 * no way to make it go away short of deleting a file they want to keep.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    channel?: string;
    shortIds?: number[];
  };
  const channel = body.channel ? parseChannel(body.channel) : undefined;
  if (!hasShortsPermission(session, channel)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ids = (body.shortIds ?? []).filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length < 2) {
    return NextResponse.json(
      { error: "Need at least two clips" },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, dismissed: dismissDupeGroup(ids) });
}
