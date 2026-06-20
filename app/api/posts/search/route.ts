import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { handleOf } from "@/lib/directory";

export const dynamic = "force-dynamic";

// Search accounts (users + mirrored photo AND video creators) and hashtags.
// Account search is a substring LIKE over username/name + display_name; tags
// over post_hashtags. Accounts are deduped by handle (a person with both photos
// and shorts appears once).
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

  // Video creators (shorts) — name isn't normalized, so key by its handle.
  const shortCreators = db
    .prepare(
      `SELECT DISTINCT name FROM short_profiles
        WHERE LOWER(name) LIKE ? ORDER BY name LIMIT 20`
    )
    .all(like) as { name: string }[];

  const tags = db
    .prepare(
      `SELECT tag, COUNT(*) AS count FROM post_hashtags
        WHERE tag LIKE ?
        GROUP BY tag ORDER BY count DESC LIMIT 10`
    )
    .all(like) as { tag: string; count: number }[];

  // Dedupe by handle, preferring user > photo creator > video creator.
  const byHandle = new Map<string, { username: string; display_name: string | null; type: "user" | "creator" }>();
  const add = (username: string, display_name: string | null, type: "user" | "creator") => {
    const h = handleOf(username);
    if (h && !byHandle.has(h)) byHandle.set(h, { username, display_name, type });
  };
  for (const u of users) add(u.username, u.display_name, "user");
  for (const c of creators) add(c.username, c.display_name, "creator");
  for (const s of shortCreators) add(handleOf(s.name), s.name, "creator");

  return NextResponse.json({ accounts: Array.from(byHandle.values()).slice(0, 20), tags });
}
