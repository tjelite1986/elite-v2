import { NextResponse } from "next/server";
import fs from "node:fs";
import { qb, getOne } from "@/lib/kysely";
import { getSession } from "@/lib/auth";
import { setAvatarKey } from "@/lib/profiles";
import { avatarMimeFor, avatarPathFor, storeAvatar } from "@/lib/avatars";

export const dynamic = "force-dynamic";

// The account avatar, by username.
//
// This used to serve any handle in the shared people namespace — accounts and
// the creators the posts library was filed under. That library is its own app
// since 2026-09-16 and took the creator avatars with it, so what is left here
// is what this app owns: the picture belonging to an account. The path is
// unchanged on purpose — it is the `avatarUrl` the verify endpoint hands to
// Elitogram, and it is baked into every avatar already rendered in a client.

// The account holder, or an admin, may set the picture.
async function authorize(username: string) {
  const session = await getSession();
  if (!session) return { error: "Unauthorized", status: 401 as const };
  if (session.role === "admin") return { session };
  const me = getOne<{ username: string }>(
    qb
      .selectFrom("user_profiles")
      .select("username")
      .where("user_id", "=", Number(session.sub))
  );
  if (me && me.username.toLowerCase() === username) return { session };
  return { error: "Forbidden", status: 403 as const };
}

function accountFor(username: string) {
  return getOne<{ user_id: number; avatar_key: string | null }>(
    qb
      .selectFrom("user_profiles")
      .select(["user_id", "avatar_key"])
      .where("username", "=", username)
  );
}

// Replace this account's picture with an uploaded (cropped) image.
export async function POST(
  request: Request,
  props: { params: Promise<{ username: string }> }
) {
  const params = await props.params;
  const username = params.username.toLowerCase();
  const auth = await authorize(username);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const account = accountFor(username);
  if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "An image is required." }, { status: 400 });
  }
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const key = await storeAvatar(file.name, file.type, buffer);
    setAvatarKey(account.user_id, key);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not process the image." },
      { status: 400 }
    );
  }
}

// Serve the picture. 404 when none is set, so the client falls back to the
// initials placeholder rather than showing a broken image.
export async function GET(
  request: Request,
  props: { params: Promise<{ username: string }> }
) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const avatarKey = accountFor(params.username.toLowerCase())?.avatar_key;
  if (!avatarKey) return new NextResponse("Not found", { status: 404 });
  const filePath = avatarPathFor(avatarKey);
  if (!fs.existsSync(filePath)) return new NextResponse("Not found", { status: 404 });

  // The URL is keyed by username (stable) but the file changes when the picture
  // does, so the response is tagged with the key: the browser revalidates every
  // time and an unchanged picture comes back as a cheap 304. A long max-age
  // would keep serving the old one everywhere it is rendered.
  const etag = `"${avatarKey}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": "private, no-cache" },
    });
  }

  return new NextResponse(fs.readFileSync(filePath), {
    headers: {
      "Content-Type": avatarMimeFor(avatarKey),
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      ETag: etag,
      "Cache-Control": "private, no-cache",
    },
  });
}
