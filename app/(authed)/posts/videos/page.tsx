import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ensureUserProfile } from "@/lib/profiles";
import VideosViews from "@/components/videos-views";

export const dynamic = "force-dynamic";

// Videos: every post that carries video media (Instagram videos and other clips
// that don't belong in Shorts), presented in the same immersive vertical-swipe
// view as the Shorts feed.
export default async function PostsVideosPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  ensureUserProfile(Number(session.sub), session.email);

  return (
    <VideosViews
      viewer={{ userId: Number(session.sub), isAdmin: session.role === "admin" }}
      storageKey="videos-view"
      restoreKey="posts:videos"
    />
  );
}
