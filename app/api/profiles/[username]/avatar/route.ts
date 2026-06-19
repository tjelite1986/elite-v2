import { NextResponse } from "next/server";
import fs from "node:fs";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
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
  const row =
    (db
      .prepare("SELECT avatar_key FROM user_profiles WHERE username = ?")
      .get(username) as { avatar_key: string | null } | undefined) ??
    (db
      .prepare("SELECT avatar_key FROM post_creators WHERE username = ?")
      .get(username) as { avatar_key: string | null } | undefined);

  if (!row?.avatar_key) return new NextResponse("Not found", { status: 404 });
  const filePath = avatarPathFor(row.avatar_key);
  if (!fs.existsSync(filePath)) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(fs.readFileSync(filePath), {
    headers: {
      "Content-Type": imageMimeFor(row.avatar_key),
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=86400",
    },
  });
}
