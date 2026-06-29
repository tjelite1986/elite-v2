import { NextResponse } from "next/server";
import fs from "node:fs";
import { PostMediaRow, PostRow, ShortRow } from "@/lib/db";
import { qb, getOne } from "@/lib/kysely";
import { getSession } from "@/lib/auth";
import { getHandleAvatar, setHandleAvatar } from "@/lib/profiles";
import { handleOf } from "@/lib/directory";
import { avatarPathFor, imageMimeFor, mediaPathFor, storeAvatar } from "@/lib/posts-storage";
import { posterPathFor } from "@/lib/shorts-storage";

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

// Set this profile's avatar. Handle-scoped so it works for the viewer's own
// profile or, for admins, any profile — and the picture always lands on the
// profile being viewed, never re-derived from the media's owner. Three sources:
//   - multipart `file`: a (cropped) uploaded image
//   - JSON `{ mediaId }`: an existing post photo
//   - JSON `{ shortId }`: a clip's video thumbnail (poster frame)
export async function POST(
  request: Request,
  { params }: { params: { username: string } }
) {
  const handle = handleOf(params.username);
  const auth = await authorize(handle);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const contentType = request.headers.get("content-type") || "";

  // JSON: reuse an existing photo (mediaId) or a clip thumbnail (shortId).
  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    // A non-admin may only reuse media they OWN (their own posts/clips) — the
    // avatar is served publicly, so picking arbitrary media would exfiltrate
    // private/18+ content the caller can't otherwise view. Admins are exempt.
    const isAdmin = auth.session.role === "admin";
    const userId = Number(auth.session.sub);
    try {
      let sourcePath: string;
      let nameHint: string;
      if (body?.shortId != null) {
        const short = getOne<ShortRow>(
          qb
            .selectFrom("shorts")
            .selectAll()
            .where("id", "=", Number(body.shortId))
            .where("is_deleted", "=", 0)
        );
        if (!short || !short.poster_key) {
          return NextResponse.json({ error: "This clip has no thumbnail yet." }, { status: 400 });
        }
        if (!isAdmin && short.uploader_id !== userId) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        sourcePath = posterPathFor(short.channel, short.poster_key);
        nameHint = short.poster_key;
      } else if (body?.mediaId != null) {
        const media = getOne<PostMediaRow>(
          qb.selectFrom("post_media").selectAll().where("id", "=", Number(body.mediaId))
        );
        if (!media) return NextResponse.json({ error: "Not found" }, { status: 404 });
        const post = getOne<PostRow>(
          qb
            .selectFrom("posts")
            .selectAll()
            .where("id", "=", media.post_id)
            .where("is_deleted", "=", 0)
        );
        if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
        if (!isAdmin && post.author_user_id !== userId) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        sourcePath = mediaPathFor(media.storage_key);
        nameHint = media.storage_key;
      } else {
        return NextResponse.json({ error: "mediaId or shortId is required." }, { status: 400 });
      }
      if (!fs.existsSync(sourcePath)) {
        return NextResponse.json({ error: "Source image missing." }, { status: 404 });
      }
      const key = await storeAvatar(nameHint, "image/jpeg", fs.readFileSync(sourcePath));
      setHandleAvatar(handle, key);
      return NextResponse.json({ ok: true });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Could not set avatar." },
        { status: 400 }
      );
    }
  }

  // Multipart: upload a (cropped) image file.
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
