import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canAccessChannel, getShort } from "@/lib/shorts";
import { moveShortToVideoPost } from "@/lib/shorts-to-post";

export const dynamic = "force-dynamic";

// Move a clip out of shorts into the posts Videos tab (the uploader of their
// own clip, or an admin) — same guard as the channel move. The short is
// retired once the video post exists.
export async function POST(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const short = getShort(Number(params.id));
  if (!short) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const isOwner = short.uploader_id === Number(session.sub);
  if (session.role !== "admin" && !isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await canAccessChannel(short.channel))) {
    return NextResponse.json({ error: "Locked" }, { status: 403 });
  }

  try {
    const result = await moveShortToVideoPost(short);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, postId: result.postId });
  } catch (err) {
    console.error("[shorts] move to post failed:", err);
    return NextResponse.json({ error: "Move failed." }, { status: 500 });
  }
}
