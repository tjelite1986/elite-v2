import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { notify } from "@/lib/notifications";

export const dynamic = "force-dynamic";

// Toggle following a user or a creator. Notifies a followed user.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = Number(session.sub);

  const body = await request.json().catch(() => ({}));
  const targetType = body?.targetType === "creator" ? "creator" : "user";
  const targetId = Number(body?.targetId);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return NextResponse.json({ error: "Invalid target." }, { status: 400 });
  }
  if (targetType === "user" && targetId === userId) {
    return NextResponse.json({ error: "You cannot follow yourself." }, { status: 400 });
  }

  // Validate the target exists so we never store dangling follows.
  const exists =
    targetType === "user"
      ? db.prepare("SELECT 1 FROM user_profiles WHERE user_id = ?").get(targetId)
      : db.prepare("SELECT 1 FROM post_creators WHERE id = ?").get(targetId);
  if (!exists) return NextResponse.json({ error: "Target not found." }, { status: 404 });

  const has = db
    .prepare(
      "SELECT 1 FROM follows WHERE follower_id = ? AND target_type = ? AND target_id = ?"
    )
    .get(userId, targetType, targetId);

  let following: boolean;
  if (has) {
    db.prepare(
      "DELETE FROM follows WHERE follower_id = ? AND target_type = ? AND target_id = ?"
    ).run(userId, targetType, targetId);
    following = false;
  } else {
    db.prepare(
      "INSERT INTO follows (follower_id, target_type, target_id) VALUES (?, ?, ?)"
    ).run(userId, targetType, targetId);
    following = true;
    if (targetType === "user") {
      notify({ recipientId: targetId, actorId: userId, type: "follow" });
    }
  }

  const follower_count = (
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM follows WHERE target_type = ? AND target_id = ?"
      )
      .get(targetType, targetId) as { c: number }
  ).c;
  return NextResponse.json({ ok: true, following, follower_count });
}
