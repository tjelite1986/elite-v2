import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { qb, getOne } from "@/lib/kysely";
import { getSession } from "@/lib/auth";
import { notify } from "@/lib/notifications";

export const dynamic = "force-dynamic";

// Toggle following a user or a creator. Notifies a followed user.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = Number(session.sub);

  const body = await request.json().catch(() => ({}));
  const targetType =
    body?.targetType === "creator"
      ? "creator"
      : body?.targetType === "shorts"
        ? "shorts"
        : "user";
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
      ? getOne(qb.selectFrom("user_profiles").select("user_id").where("user_id", "=", targetId))
      : targetType === "creator"
        ? getOne(qb.selectFrom("post_creators").select("id").where("id", "=", targetId))
        : getOne(qb.selectFrom("short_profiles").select("id").where("id", "=", targetId));
  if (!exists) return NextResponse.json({ error: "Target not found." }, { status: 404 });

  const has = getOne(
    qb
      .selectFrom("follows")
      .select("follower_id")
      .where("follower_id", "=", userId)
      .where("target_type", "=", targetType)
      .where("target_id", "=", targetId)
  );

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

  const follower_count =
    getOne<{ c: number }>(
      qb
        .selectFrom("follows")
        .select((eb) => eb.fn.countAll<number>().as("c"))
        .where("target_type", "=", targetType)
        .where("target_id", "=", targetId)
    )?.c ?? 0;
  return NextResponse.json({ ok: true, following, follower_count });
}
