import { NextResponse } from "next/server";
import { sql } from "kysely";
import { qb, getAll } from "@/lib/kysely";
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

  const users = getAll<{ username: string; display_name: string | null }>(
    qb
      .selectFrom("user_profiles")
      .select(["username", "display_name"])
      .where(sql<boolean>`(username LIKE ${like} OR LOWER(display_name) LIKE ${like})`)
      .orderBy("username")
      .limit(10)
  );

  const creators = getAll<{ username: string; display_name: string | null }>(
    qb
      .selectFrom("post_creators")
      .select(["username", "display_name"])
      .where(sql<boolean>`(username LIKE ${like} OR LOWER(display_name) LIKE ${like})`)
      .orderBy("username")
      .limit(10)
  );

  // Video creators (shorts) — name isn't normalized, so key by its handle.
  const shortCreators = getAll<{ name: string }>(
    qb
      .selectFrom("short_profiles")
      .select("name")
      .distinct()
      .where(sql<boolean>`LOWER(name) LIKE ${like}`)
      .orderBy("name")
      .limit(20)
  );

  const tags = getAll<{ tag: string; count: number }>(
    qb
      .selectFrom("post_hashtags")
      .select((eb) => ["tag", eb.fn.countAll<number>().as("count")])
      .where("tag", "like", like)
      .groupBy("tag")
      .orderBy("count", "desc")
      .limit(10)
  );

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
