import { NextResponse } from "next/server";
import { sql } from "kysely";
import { qb, getAll } from "@/lib/kysely";
import { getSession } from "@/lib/auth";
import { decideImportReview } from "@/lib/user-import";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface ReviewItem {
  id: number;
  user_id: number;
  original_name: string;
  collection: string | null;
  matched_post_id: number | null;
  match_type: string | null;
  matched_media_id: number | null;
  created_at: string;
  owner_email: string;
}

// Parked duplicate imports awaiting a decision. Admins see everyone's (drop
// folders belong to individual accounts but are usually managed by the admin);
// other users see their own.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const meId = Number(session.sub);

  let q = qb
    .selectFrom("import_review as r")
    .innerJoin("users as u", "u.id", "r.user_id")
    .select([
      "r.id",
      "r.user_id",
      "r.original_name",
      "r.collection",
      "r.matched_post_id",
      "r.match_type",
      "r.created_at",
      "u.email as owner_email",
      sql<number | null>`(SELECT pm.id FROM post_media pm WHERE pm.post_id = r.matched_post_id ORDER BY pm.position, pm.id LIMIT 1)`.as(
        "matched_media_id"
      ),
    ])
    .orderBy("r.id", "desc");
  if (session.role !== "admin") q = q.where("r.user_id", "=", meId);

  const items = getAll<ReviewItem>(q);
  return NextResponse.json({ items, count: items.length });
}

// Decide a parked duplicate: import anyway, or discard the file. With
// { action: "discard", scope: "exact" } every exact-copy item the requester
// can see is discarded in one call (similar matches always stay for a manual
// look — a "similar" can be a different photo from the same shoot).
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const requester = {
    userId: Number(session.sub),
    isAdmin: session.role === "admin",
  };

  const body = await request.json().catch(() => null);
  const action = body?.action;

  if (action === "discard" && body?.scope === "exact") {
    // Rows from before the match_type column exist as NULL and are exact
    // matches too (the UI labels everything non-"similar" as exact copy).
    let q = qb
      .selectFrom("import_review")
      .select("id")
      .where((eb) =>
        eb.or([eb("match_type", "is", null), eb("match_type", "!=", "similar")])
      );
    if (!requester.isAdmin) q = q.where("user_id", "=", requester.userId);
    const ids = getAll<{ id: number }>(q).map((r) => r.id);
    let discarded = 0;
    for (const rid of ids) {
      const res = await decideImportReview(rid, requester, "discard");
      if (res.ok) discarded++;
    }
    return NextResponse.json({ ok: true, discarded, total: ids.length });
  }

  const id = Number(body?.id);
  if (!Number.isInteger(id) || (action !== "import" && action !== "discard")) {
    return NextResponse.json(
      { error: "id and action (import|discard) are required." },
      { status: 400 }
    );
  }

  const result = await decideImportReview(id, requester, action);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
}
