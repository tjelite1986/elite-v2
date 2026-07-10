import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getStory, markStoryViewed } from "@/lib/stories";

export const dynamic = "force-dynamic";

// Mark a story as seen by the viewer.
export async function POST(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const story = getStory(Number(params.id));
  if (!story) return NextResponse.json({ error: "Not found" }, { status: 404 });

  markStoryViewed(story.id, Number(session.sub));
  return NextResponse.json({ ok: true });
}
