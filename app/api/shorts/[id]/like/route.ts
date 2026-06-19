import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { canAccessChannel, getShort } from "@/lib/shorts";

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
  if (!(await canAccessChannel(short.channel))) {
    return NextResponse.json({ error: "Locked" }, { status: 403 });
  }

  const existing = db
    .prepare("SELECT 1 FROM short_likes WHERE short_id = ? AND user_id = ?")
    .get(short.id, userId);

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

  const count = (
    db
      .prepare("SELECT COUNT(*) AS n FROM short_likes WHERE short_id = ?")
      .get(short.id) as { n: number }
  ).n;

  return NextResponse.json({ ok: true, liked: !existing, like_count: count });
}
