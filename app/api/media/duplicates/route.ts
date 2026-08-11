import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import type { ShortChannel, VideoChannel } from "@/lib/db";
import { has18Access } from "@/lib/shorts-gate";
import { canAccessVideoChannel } from "@/lib/videos";
import {
  deleteDuplicateMembers,
  dismissPair,
  duplicateGroups,
  type MediaKind,
} from "@/lib/media-dedup";

export const dynamic = "force-dynamic";

interface MemberDetail {
  id: number;
  channel: string;
  label: string;
  duration: number | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  poster_key: string | null;
  created_at: string;
}

function shortDetails(ids: number[]): Map<number, MemberDetail> {
  if (ids.length === 0) return new Map();
  const rows = db
    .prepare(
      `SELECT id, channel, caption AS label, duration, size_bytes, width, height,
              poster_key, created_at
         FROM shorts WHERE id IN (${ids.map(() => "?").join(",")})`
    )
    .all(...ids) as MemberDetail[];
  return new Map(rows.map((r) => [r.id, r]));
}

function videoDetails(ids: number[]): Map<number, MemberDetail> {
  if (ids.length === 0) return new Map();
  const rows = db
    .prepare(
      `SELECT id, channel, title AS label, duration, size_bytes, width, height,
              poster_key, added_at AS created_at
         FROM videos WHERE id IN (${ids.map(() => "?").join(",")})`
    )
    .all(...ids) as MemberDetail[];
  return new Map(rows.map((r) => [r.id, r]));
}

/** Whether the caller may see a given channel, resolved once per request. */
async function visibilityFilter(
  kind: MediaKind
): Promise<(channel: string) => boolean> {
  if (kind === "short") {
    const can18 = await has18Access();
    return (channel) => (channel as ShortChannel) !== "18plus" || can18;
  }
  const canAdults = await canAccessVideoChannel("adults");
  return (channel) => (channel as VideoChannel) !== "adults" || canAdults;
}

// Duplicate groups for one media kind, enriched with what the review UI needs
// to compare quality at a glance.
//
// Members the caller cannot see are dropped, and a group that falls below two
// visible members disappears entirely — otherwise the 18+ half of a mixed
// group would be inferable from a gap in the list.
export async function GET(request: Request) {
  const session = await getSession();
  if (session?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const kind = (url.searchParams.get("kind") || "short") as MediaKind;
  if (kind !== "short" && kind !== "video") {
    return NextResponse.json({ error: "Unknown kind" }, { status: 400 });
  }
  const includeRecolored = url.searchParams.get("recolored") === "1";

  const groups = duplicateGroups(kind, { includeRecolored });
  const allIds = [...new Set(groups.flatMap((g) => g.members))];
  const details =
    kind === "short" ? shortDetails(allIds) : videoDetails(allIds);

  const visible = await visibilityFilter(kind);

  const enriched = groups
    .map((group) => ({
      ...group,
      members: group.members
        .map((id) => details.get(id))
        .filter((m): m is MemberDetail => Boolean(m) && visible(m!.channel))
        // Biggest first: within a duplicate group the largest file is usually
        // the one worth keeping.
        .sort((a, b) => (b.size_bytes ?? 0) - (a.size_bytes ?? 0)),
    }))
    .filter((g) => g.members.length > 1);

  return NextResponse.json({ groups: enriched });
}

/** Record that a pair is not actually a duplicate, so it stops being offered. */
export async function POST(request: Request) {
  const session = await getSession();
  if (session?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    kind?: MediaKind;
    ids?: number[];
  };
  const kind = body.kind === "video" ? "video" : "short";
  const ids = (body.ids ?? []).filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length < 2) {
    return NextResponse.json(
      { error: "Need at least two ids" },
      { status: 400 }
    );
  }

  const canSee = await visibilityFilter(kind);
  const details = kind === "short" ? shortDetails(ids) : videoDetails(ids);
  for (const id of ids) {
    const row = details.get(id);
    if (!row || !canSee(row.channel)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  // Dismiss every pair in the group, so the whole group stops reappearing
  // rather than fragmenting into smaller ones on the next scan.
  let pairs = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      dismissPair(kind, ids[i], ids[j]);
      pairs++;
    }
  }
  return NextResponse.json({ ok: true, dismissed: pairs });
}

/**
 * Delete duplicate members. Destructive and admin-only, and the caller must
 * send the whole group so the server can refuse to delete every copy.
 */
export async function DELETE(request: Request) {
  const session = await getSession();
  if (session?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    kind?: MediaKind;
    ids?: number[];
    groupMembers?: number[];
  };
  const kind = body.kind === "video" ? "video" : "short";
  const ids = (body.ids ?? []).filter((n) => Number.isInteger(n) && n > 0);
  const groupMembers = (body.groupMembers ?? []).filter(
    (n) => Number.isInteger(n) && n > 0
  );
  if (ids.length === 0) {
    return NextResponse.json({ error: "Nothing to delete" }, { status: 400 });
  }
  if (!ids.every((id) => groupMembers.includes(id))) {
    return NextResponse.json(
      { error: "Every id must belong to the group" },
      { status: 400 }
    );
  }

  // Deleting reaches the filesystem, so the channel check is not optional:
  // an id alone says nothing about which channel it belongs to.
  const canSee = await visibilityFilter(kind);
  const details =
    kind === "short" ? shortDetails(groupMembers) : videoDetails(groupMembers);
  for (const id of groupMembers) {
    const row = details.get(id);
    if (!row || !canSee(row.channel)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  const result = deleteDuplicateMembers(kind, ids, groupMembers);
  return NextResponse.json({ ok: result.deleted > 0, ...result });
}
