import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ensureUserProfile, setAvatarKey, setHandleAvatar } from "@/lib/profiles";
import { handleOf } from "@/lib/directory";
import { storeAvatar } from "@/lib/posts-storage";

export const dynamic = "force-dynamic";

// Upload/replace the current user's avatar.
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
    const key = await storeAvatar(file.name, file.type, buffer);
    setAvatarKey(userId, key);
    setHandleAvatar(handleOf(profile.username), key);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not process the image." },
      { status: 400 }
    );
  }
}
