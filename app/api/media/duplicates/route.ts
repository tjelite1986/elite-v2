import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import type { ShortChannel, VideoChannel } from "@/lib/db";
import { has18Access } from "@/lib/shorts-gate";
import { canAccessVideoChannel } from "@/lib/videos";
import { duplicateGroups, type MediaKind } from "@/lib/media-dedup";

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

  const can18 = await has18Access();
  const canAdults = await canAccessVideoChannel("adults");
  const visible = (channel: string): boolean =>
    kind === "short"
      ? (channel as ShortChannel) !== "18plus" || can18
      : (channel as VideoChannel) !== "adults" || canAdults;

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
