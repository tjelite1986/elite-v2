import { NextResponse } from "next/server";
import fs from "node:fs";
import { qb, getOne } from "@/lib/kysely";
import { getSession } from "@/lib/auth";
import { getHandleAvatar } from "@/lib/profiles";
import { handleOf } from "@/lib/directory";
import { avatarPathFor, imageMimeFor } from "@/lib/posts-storage";

export const dynamic = "force-dynamic";

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
