import { NextResponse } from "next/server";
import { qb, getOne } from "@/lib/kysely";
import { getSession } from "@/lib/auth";
import { handleOf } from "@/lib/directory";
import { listAliases, addAlias, removeAlias } from "@/lib/profile-links";

export const dynamic = "force-dynamic";

// Alternate @handles/names that resolve to this profile. Managed by the profile
// owner or an admin. Backed by profile_links, so a tagged alias links to the
// same face as the canonical handle.

// Admins, or the user whose own handle this is, may manage a profile's aliases.
async function authorize(handle: string) {
  const session = await getSession();
  if (!session) return { error: "Unauthorized", status: 401 as const };
  if (session.role === "admin") return { session };
  const me = getOne<{ username: string }>(
    qb
      .selectFrom("user_profiles")
      .select("username")
      .where("user_id", "=", Number(session.sub))
  );
  if (me && handleOf(me.username) === handle) return { session };
  return { error: "Forbidden", status: 403 as const };
}

export async function GET(
  _request: Request,
  props: { params: Promise<{ username: string }> }
) {
  const params = await props.params;
  const handle = handleOf(params.username);
  const auth = await authorize(handle);
  if ("error" in auth)
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ aliases: listAliases(handle) });
}

// POST { alias } — add an alternate handle that resolves to this profile.
export async function POST(
  request: Request,
  props: { params: Promise<{ username: string }> }
) {
  const params = await props.params;
  const handle = handleOf(params.username);
  const auth = await authorize(handle);
  if ("error" in auth)
    return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) ?? {};
  const result = addAlias(handle, String(body?.alias ?? ""));
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    ok: true,
    alias: result.alias,
    aliases: listAliases(handle),
  });
}

// DELETE { alias } — remove an alternate handle.
export async function DELETE(
  request: Request,
  props: { params: Promise<{ username: string }> }
) {
  const params = await props.params;
  const handle = handleOf(params.username);
  const auth = await authorize(handle);
  if ("error" in auth)
    return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) ?? {};
  const alias = String(body?.alias ?? "");
  if (!alias) {
    return NextResponse.json({ error: "An alias is required." }, { status: 400 });
  }
  removeAlias(handle, alias);
  return NextResponse.json({ ok: true, aliases: listAliases(handle) });
}
