import { NextResponse } from "next/server";
import { db, GalleryItemRow } from "@/lib/db";
import { qb, getOne } from "@/lib/kysely";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

function getOwned(id: number, userId: number): GalleryItemRow | undefined {
  return getOne<GalleryItemRow>(
    qb
      .selectFrom("gallery_items")
      .selectAll()
      .where("id", "=", id)
      .where("user_id", "=", userId)
  );
}

// Full details for one item (for the info panel).
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const item = getOwned(Number(params.id), Number(session.sub));
  if (!item) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ item });
}

// Normalise a datetime-local / date string to SQLite "YYYY-MM-DD HH:MM:SS".
function normalizeDate(input: string): string | null {
  const m = String(input).match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (!m) return null;
  const [, y, mo, d, h = "12", mi = "00", s = "00"] = m;
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return null;
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

// Edit user-supplied metadata: date, description, place name.
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = Number(session.sub);

  const item = getOwned(Number(params.id), userId);
  if (!item) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const sets: string[] = [];
  const values: (string | null)[] = [];

  if (typeof body.taken_at === "string") {
    const norm = normalizeDate(body.taken_at);
    if (!norm) return NextResponse.json({ error: "Invalid date." }, { status: 400 });
    sets.push("taken_at = ?");
    values.push(norm);
  }
  if ("description" in body) {
    const d = body.description ? String(body.description).slice(0, 2000) : null;
    sets.push("description = ?");
    values.push(d);
  }
  if ("location_name" in body) {
    const l = body.location_name ? String(body.location_name).slice(0, 200) : null;
    sets.push("location_name = ?");
    values.push(l);
  }
  if ("rating" in body) {
    const r = Math.max(0, Math.min(5, Math.round(Number(body.rating) || 0)));
    sets.push("rating = ?");
    values.push(String(r));
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  values.push(String(item.id), String(userId));
  db.prepare(
    `UPDATE gallery_items SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`
  ).run(...values);

  return NextResponse.json({ ok: true });
}
