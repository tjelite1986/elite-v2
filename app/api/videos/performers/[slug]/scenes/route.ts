import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { canAccessVideoChannel } from "@/lib/videos";
import { getPerformer } from "@/lib/video-performers";
import { performerRecords, tpdbConfigured, type TpdbType } from "@/lib/tpdb";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Everything ThePornDB credits this performer with, page by page. Its own
// endpoint rather than part of the profile record: it is a third-party call
// per page view, and the profile page must render without it.
export async function GET(
  request: Request,
  props: { params: Promise<{ slug: string }> }
) {
  const { slug } = await props.params;
  const session = await getSession();
  // Admin-only, like every other route that spends the API key.
  if (session?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await canAccessVideoChannel("adults"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!tpdbConfigured()) {
    return NextResponse.json({ error: "TPDB_API_KEY is not set" }, { status: 503 });
  }

  const performer = getPerformer(slug);
  if (!performer) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!performer.tpdb_id) {
    return NextResponse.json(
      {
        error:
          "This profile has no ThePornDB id. Fetch it by id from Edit first.",
      },
      { status: 400 }
    );
  }

  const url = new URL(request.url);
  const type: TpdbType = url.searchParams.get("type") === "movie" ? "movie" : "scene";
  const page = Number(url.searchParams.get("page")) || 1;

  try {
    const result = await performerRecords(performer.tpdb_id, type, page);
    // Which of these are already in the library: the film's stored id is the
    // same identifier, so the list can say "you have this one".
    const owned = new Map<string, number>();
    if (result.items.length) {
      const placeholders = result.items.map(() => "?").join(", ");
      const rows = db
        .prepare(
          `SELECT id, meta_id FROM videos
            WHERE channel = 'adults' AND meta_id IN (${placeholders})`
        )
        .all(...result.items.map((i) => i.id)) as {
        id: number;
        meta_id: string;
      }[];
      for (const row of rows) owned.set(row.meta_id, row.id);
    }

    return NextResponse.json({
      page: result.page,
      lastPage: result.lastPage,
      total: result.total,
      type,
      items: result.items.map((item) => ({
        id: item.id,
        type: item.type,
        title: item.title,
        studio: item.studio,
        date: item.date,
        duration: item.duration,
        posterUrl: item.posterUrl,
        performers: item.performers,
        videoId: owned.get(item.id) ?? null,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: String((err as Error)?.message || err) },
      { status: 502 }
    );
  }
}
