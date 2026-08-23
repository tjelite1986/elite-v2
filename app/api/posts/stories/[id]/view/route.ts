import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isFollowing } from "@/lib/posts";
import { adultAuthorId, getStory, markStoryViewed } from "@/lib/stories";
import { has18Access } from "@/lib/shorts-gate";

export const dynamic = "force-dynamic";

// Mark a story as seen by the viewer. Same access scope as the media route:
// author or follower, plus the 18+ gate for the adult content account — a
// locked-out viewer must not be able to poll this endpoint to bump the count.
export async function POST(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const viewerId = Number(session.sub);

  const story = getStory(Number(params.id));
  if (!story) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (
    story.author_user_id !== viewerId &&
    !isFollowing(viewerId, "user", story.author_user_id)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const adultId = adultAuthorId();
  if (
    adultId !== null &&
    story.author_user_id === adultId &&
    viewerId !== adultId &&
    !(await has18Access())
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  markStoryViewed(story.id, viewerId);
  return NextResponse.json({ ok: true });
}
