import { NextResponse } from "next/server";
import fs from "node:fs";
import { qb, getOne } from "@/lib/kysely";
import { getSession } from "@/lib/auth";
import { getHandleAvatar, setHandleAvatar } from "@/lib/profiles";
import { handleOf } from "@/lib/directory";
import { avatarPathFor, imageMimeFor, storeAvatar } from "@/lib/posts-storage";

export const dynamic = "force-dynamic";

// Admins, or the user whose own handle this is, may set this profile's avatar.
async function authorize(handle: string) {
  const session = await getSession();
  if (!session) return { error: "Unauthorized", status: 401 as const };
  if (session.role === "admin") return { session };
  const me = getOne<{ username: string }>(
    qb.selectFrom("user_profiles").select("username").where("user_id", "=", Number(session.sub))
  );
  if (me && handleOf(me.username) === handle) return { session };
  return { error: "Forbidden", status: 403 as const };
}

// Upload/replace this profile's avatar from an image file. Handle-scoped so it
// works for the viewer's own profile or, for admins, any profile.
export async function POST(
  request: Request,
  { params }: { params: { username: string } }
) {
  const handle = handleOf(params.username);
  const auth = await authorize(handle);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "An image is required." }, { status: 400 });
  }
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const key = await storeAvatar(file.name, file.type, buffer);
    setHandleAvatar(handle, key);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not process the image." },
      { status: 400 }
    );
  }
}

// Serve a user's or creator's avatar by username. 404 when none is set so the
// client falls back to an initials placeholder.
export async function GET(
  request: Request,
  { params }: { params: { username: string } }
) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const username = params.username.toLowerCase();
  // Handle-scoped avatar wins; fall back to the legacy per-table columns.
  const avatarKey =
    getHandleAvatar(handleOf(username)) ??
    (
      getOne<{ avatar_key: string | null }>(
        qb.selectFrom("user_profiles").select("avatar_key").where("username", "=", username)
      ) ??
      getOne<{ avatar_key: string | null }>(
        qb.selectFrom("post_creators").select("avatar_key").where("username", "=", username)
      )
    )?.avatar_key;

  if (!avatarKey) return new NextResponse("Not found", { status: 404 });
  const filePath = avatarPathFor(avatarKey);
  if (!fs.existsSync(filePath)) return new NextResponse("Not found", { status: 404 });

  // The avatar URL is keyed by username (stable), but the underlying file changes
  // when the picture is changed. Tag the response with the avatar key so the
  // browser always revalidates and picks up a new picture immediately, while
  // unchanged avatars come back as a cheap 304. (A long max-age would otherwise
  // keep serving the old picture for 24h everywhere it's rendered.)
  const etag = `"${avatarKey}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": "private, no-cache" },
    });
  }

  return new NextResponse(fs.readFileSync(filePath), {
    headers: {
      "Content-Type": imageMimeFor(avatarKey),
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      ETag: etag,
      "Cache-Control": "private, no-cache",
    },
  });
}
