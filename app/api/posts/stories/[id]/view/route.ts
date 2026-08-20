import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isFollowing } from "@/lib/posts";
import { getStory, markStoryViewed, adultAuthorId } from "@/lib/stories";
import { has18Access } from "@/lib/shorts-gate";

export const dynamic = "force-dynamic";

// Mark a story as seen by the viewer. Re-checks the same access rules as the
// story media route, rather than trusting the caller was able to render the
// story before this ran.
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
