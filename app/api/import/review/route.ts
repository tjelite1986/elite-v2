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

// Decide a parked duplicate: import anyway, or discard the file.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const id = Number(body?.id);
  const action = body?.action;
  if (!Number.isInteger(id) || (action !== "import" && action !== "discard")) {
    return NextResponse.json(
      { error: "id and action (import|discard) are required." },
      { status: 400 }
    );
  }

  const result = await decideImportReview(
    id,
    { userId: Number(session.sub), isAdmin: session.role === "admin" },
    action
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
}
