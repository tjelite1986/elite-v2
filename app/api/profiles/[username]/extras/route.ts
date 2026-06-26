import { NextResponse } from "next/server";
import { qb, getOne } from "@/lib/kysely";
import { getSession } from "@/lib/auth";
import {
  getProfileExtras,
  setProfileBio,
  setProfileLinks,
  setProfileCustomFields,
  setProfileBanner,
  setProfileInstagram,
  setProfileLocation,
} from "@/lib/profiles";
import { handleOf } from "@/lib/directory";
import { parseInstagramUsername } from "@/lib/instagram";
import { storeBanner } from "@/lib/posts-storage";

export const dynamic = "force-dynamic";

// Admins, or the user whose own handle this is, may edit a profile's extras.
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

// Update any subset of a profile's extras. Each field is independent: only the
// keys actually present in the body are written, so a partial update (e.g. just
// `location`) leaves bio/links/Instagram untouched.
export async function PATCH(
  request: Request,
  { params }: { params: { username: string } }
) {
  const handle = handleOf(params.username);
  const auth = await authorize(handle);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json().catch(() => ({}))) ?? {};

  if ("bio" in body) {
    setProfileBio(handle, typeof body.bio === "string" ? body.bio : null);
  }
  if ("links" in body) {
    setProfileLinks(handle, Array.isArray(body.links) ? body.links : []);
  }
  if ("location" in body) {
    setProfileLocation(handle, typeof body.location === "string" ? body.location : null);
  }
  if ("fields" in body) {
    setProfileCustomFields(handle, Array.isArray(body.fields) ? body.fields : []);
  }

  // Optional Instagram source: a username/URL to pull media from, plus an
  // auto-poll flag. Empty/invalid input disconnects it.
  if ("instagramHandle" in body) {
    const ig = parseInstagramUsername(String(body.instagramHandle ?? ""));
    setProfileInstagram(handle, ig, Boolean(body?.igAutoPoll));
  }
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
