import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canAccessChannel, getShort } from "@/lib/shorts";
import { moveShortChannel } from "@/lib/shorts-move";

export const dynamic = "force-dynamic";

// Move a clip between the main and 18+ channels (the uploader of their own
// clip, or an admin). The clip is re-homed like an import into the target
// channel: files move to the target tree and a creator clip gets the same-name
// profile on the target channel.
export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
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

  const body = await request.json().catch(() => ({}));
  const target = body?.channel;
  if (target !== "main" && target !== "18plus") {
    return NextResponse.json({ error: "Invalid channel." }, { status: 400 });
  }
  if (target === "18plus" && !(await canAccessChannel("18plus"))) {
    return NextResponse.json({ error: "Locked" }, { status: 403 });
  }

  try {
    const result = moveShortChannel(short.id, target);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, channel: result.channel });
  } catch (err) {
    console.error("[shorts] channel move failed:", err);
    return NextResponse.json({ error: "Move failed." }, { status: 500 });
  }
}
