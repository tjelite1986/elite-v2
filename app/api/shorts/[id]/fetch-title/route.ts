import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db, ShortProfileRow } from "@/lib/db";
import { qb, getOne } from "@/lib/kysely";
import { getShort } from "@/lib/shorts";
import { fetchOriginalTitle } from "@/lib/shorts-source";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Fetch the original title of a single clip from its source (e.g. the TikTok
// video) via yt-dlp and store it as the caption (admin only). Used to repair
// legacy imports whose titles were truncated or missing.
export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const short = getShort(Number(params.id));
  if (!short) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const profile = short.profile_id
    ? getOne<ShortProfileRow>(
        qb
          .selectFrom("short_profiles")
          .selectAll()
          .where("id", "=", short.profile_id)
      )
    : undefined;

  const title = await fetchOriginalTitle(profile?.source_ref, short.source_id);
  if (!title) {
    return NextResponse.json(
      { error: "Could not fetch a title for this clip." },
      { status: 422 }
    );
  }

  const caption = title.slice(0, 2000);
  db.prepare("UPDATE shorts SET caption = ? WHERE id = ?").run(caption, short.id);
  return NextResponse.json({ ok: true, caption });
}
