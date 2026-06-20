import { NextResponse } from "next/server";
import fs from "node:fs";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getHandleAvatar } from "@/lib/profiles";
import { handleOf } from "@/lib/directory";
import { avatarPathFor, imageMimeFor } from "@/lib/posts-storage";

export const dynamic = "force-dynamic";

// Serve a user's or creator's avatar by username. 404 when none is set so the
// client falls back to an initials placeholder.
export async function GET(
  _request: Request,
  { params }: { params: { username: string } }
) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const username = params.username.toLowerCase();
  // Handle-scoped avatar wins; fall back to the legacy per-table columns.
  const avatarKey =
    getHandleAvatar(handleOf(username)) ??
    (
      (db
        .prepare("SELECT avatar_key FROM user_profiles WHERE username = ?")
        .get(username) as { avatar_key: string | null } | undefined) ??
      (db
        .prepare("SELECT avatar_key FROM post_creators WHERE username = ?")
        .get(username) as { avatar_key: string | null } | undefined)
    )?.avatar_key;

  if (!avatarKey) return new NextResponse("Not found", { status: 404 });
  const filePath = avatarPathFor(avatarKey);
  if (!fs.existsSync(filePath)) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(fs.readFileSync(filePath), {
    headers: {
      "Content-Type": imageMimeFor(avatarKey),
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=86400",
    },
  });
}
