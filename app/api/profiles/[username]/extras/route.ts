import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  getProfileExtras,
  setProfileBioLinks,
  setProfileBanner,
} from "@/lib/profiles";
import { handleOf } from "@/lib/directory";
import { storeBanner } from "@/lib/posts-storage";

export const dynamic = "force-dynamic";

// Admins, or the user whose own handle this is, may edit a profile's extras.
async function authorize(handle: string) {
  const session = await getSession();
  if (!session) return { error: "Unauthorized", status: 401 as const };
  if (session.role === "admin") return { session };
  const me = db
    .prepare("SELECT username FROM user_profiles WHERE user_id = ?")
    .get(Number(session.sub)) as { username: string } | undefined;
  if (me && handleOf(me.username) === handle) return { session };
  return { error: "Forbidden", status: 403 as const };
}

// Update bio + labeled links.
export async function PATCH(
  request: Request,
  { params }: { params: { username: string } }
) {
  const handle = handleOf(params.username);
  const auth = await authorize(handle);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => ({}));
  const bio = typeof body?.bio === "string" ? body.bio : null;
  const links = Array.isArray(body?.links) ? body.links : [];
  setProfileBioLinks(handle, bio, links);
  return NextResponse.json({ ok: true, extras: getProfileExtras(handle) });
}

// Upload/replace the cover banner.
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
    const key = await storeBanner(file.name, file.type, buffer);
    setProfileBanner(handle, key);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not process the image." },
      { status: 400 }
    );
  }
}
