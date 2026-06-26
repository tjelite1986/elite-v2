import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Autocomplete for @-mentions (users) and #-references (channels) while writing
// a message or caption. Ported from the _modules/mention-autocomplete pattern,
// adapted to elite-v2's cookie session + user_profiles/channels schema.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").toLowerCase().slice(0, 40);
  const type = url.searchParams.get("type") ?? "user";
  const like = `${q}%`;
  const contains = `%${q}%`;

  if (type === "channel") {
    const channels = db
      .prepare(
        `SELECT id, name FROM channels WHERE LOWER(name) LIKE ? ORDER BY name ASC LIMIT 8`
      )
      .all(contains);
    return NextResponse.json({ suggestions: channels });
  }

  // Prefix matches first (more relevant), then other contains-matches.
  const users = db
    .prepare(
      `SELECT username, display_name, avatar_key
       FROM user_profiles
       WHERE username LIKE ? OR LOWER(COALESCE(display_name, '')) LIKE ?
       ORDER BY (username LIKE ?) DESC, username ASC
       LIMIT 8`
    )
    .all(contains, contains, like);
  return NextResponse.json({ suggestions: users });
}
