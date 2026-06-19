import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Search accounts (users + mirrored creators) and hashtags. Account search is a
// prefix/substring LIKE over username + display_name; tags over post_hashtags.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = (new URL(request.url).searchParams.get("q") || "").trim().toLowerCase();
  if (q.length < 1) {
    return NextResponse.json({ accounts: [], tags: [] });
  }
  const like = `%${q.replace(/[%_]/g, "")}%`;

  const users = db
    .prepare(
      `SELECT username, display_name FROM user_profiles
        WHERE username LIKE ? OR LOWER(display_name) LIKE ?
        ORDER BY username LIMIT 10`
    )
    .all(like, like) as { username: string; display_name: string | null }[];

  const creators = db
    .prepare(
      `SELECT username, display_name FROM post_creators
        WHERE username LIKE ? OR LOWER(display_name) LIKE ?
        ORDER BY username LIMIT 10`
    )
    .all(like, like) as { username: string; display_name: string | null }[];

  const tags = db
    .prepare(
      `SELECT tag, COUNT(*) AS count FROM post_hashtags
        WHERE tag LIKE ?
        GROUP BY tag ORDER BY count DESC LIMIT 10`
    )
    .all(like) as { tag: string; count: number }[];

  const accounts = [
    ...users.map((u) => ({ ...u, type: "user" as const })),
    ...creators.map((c) => ({ ...c, type: "creator" as const })),
  ];

  return NextResponse.json({ accounts, tags });
}
