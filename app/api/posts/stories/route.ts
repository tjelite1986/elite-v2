import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureUserProfile } from "@/lib/profiles";
import { authorSlug, storePostImage } from "@/lib/posts-storage";
import { getActiveStoryGroups, createStory } from "@/lib/stories";
import { has18Access } from "@/lib/shorts-gate";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Active story groups for the rail (self + followed users). Stories from the
// adult content account only appear once the viewer has cleared the 18+ gate.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const include18 = await has18Access();
  return NextResponse.json({
    groups: getActiveStoryGroups(Number(session.sub), include18),
  });
}

// Post a story (single image, expires in 24h).
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = Number(session.sub);
  const profile = ensureUserProfile(userId, session.email);

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "An image is required." }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const stored = await storePostImage(
      `stories/${authorSlug(profile.username)}`,
      file.name,
      file.type,
      buffer
    );
    const id = createStory(userId, stored.storageKey, stored.mimeType);
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not process the image." },
      { status: 400 }
    );
  }
}
