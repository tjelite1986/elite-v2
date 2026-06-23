import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { qb, getOne } from "@/lib/kysely";
import { canAccessChannel, canViewShort, getShort } from "@/lib/shorts";

export const dynamic = "force-dynamic";

// Toggle the viewer's like on a short. Returns the new like count and state.
export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = Number(session.sub);

  const short = getShort(Number(params.id));
  if (!short) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!canViewShort(short, userId, session.role === "admin")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await canAccessChannel(short.channel))) {
    return NextResponse.json({ error: "Locked" }, { status: 403 });
  }

  const existing = getOne(
    qb
      .selectFrom("short_likes")
      .select("short_id")
      .where("short_id", "=", short.id)
      .where("user_id", "=", userId)
  );

  if (existing) {
    db.prepare("DELETE FROM short_likes WHERE short_id = ? AND user_id = ?").run(
      short.id,
      userId
    );
  } else {
    db.prepare(
      "INSERT INTO short_likes (short_id, user_id) VALUES (?, ?)"
    ).run(short.id, userId);
  }

  const count =
    getOne<{ n: number }>(
      qb
        .selectFrom("short_likes")
        .select((eb) => eb.fn.countAll<number>().as("n"))
        .where("short_id", "=", short.id)
    )?.n ?? 0;

  return NextResponse.json({ ok: true, liked: !existing, like_count: count });
}
