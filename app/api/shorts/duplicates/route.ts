import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasShortsPermission } from "@/lib/permissions";
import { has18Access } from "@/lib/shorts-gate";
import { parseChannel } from "@/lib/shorts";
import {
  dismissDupeGroup,
  getDupeGroups,
  getDupeState,
  shortChannels,
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
  // The permission role above answers "can this person administer shorts?",
  // not "have they unlocked their own 18+ PIN right now" — the two are
  // independent, so an unopened scope still needs the gate.
  if ((channel === "18plus" || !channel) && !(await has18Access())) {
    return NextResponse.json({ error: "Locked" }, { status: 403 });
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
    shortIds?: number[];
  };

  const ids = (body.shortIds ?? []).filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length < 2) {
    return NextResponse.json(
      { error: "Need at least two clips" },
      { status: 400 }
    );
  }

  // Authorize against the channel each clip is really in, not one named by the
  // caller: a body claiming "main" while carrying 18+ ids must not pass on the
  // main-section permission alone.
  const channels = shortChannels(ids);
  const allowed =
    channels.size === ids.length &&
    [...channels.values()].every((c) => hasShortsPermission(session, c));
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const spans18plus = [...channels.values()].some((c) => c === "18plus");
  if (spans18plus && !(await has18Access())) {
    return NextResponse.json({ error: "Locked" }, { status: 403 });
  }

  return NextResponse.json({ ok: true, dismissed: dismissDupeGroup(ids) });
}
