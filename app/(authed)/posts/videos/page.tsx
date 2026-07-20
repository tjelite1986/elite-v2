import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ensureUserProfile } from "@/lib/profiles";
import PostViews from "@/components/post-views";

export const dynamic = "force-dynamic";

// Videos: every post that carries video media (Instagram videos and other clips
// that don't belong in Shorts land here via the importer or the composer).
export default async function PostsVideosPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  ensureUserProfile(Number(session.sub), session.email);

  return (
    <div className="w-full pb-24 pt-24 text-white">
      <PostViews
        query={{ scope: "explore", videos: "1" }}
        empty="No videos yet — share one from Create, or import Instagram videos."
        viewer={{ userId: Number(session.sub), isAdmin: session.role === "admin" }}
        storageKey="posts-view-videos"
        defaultView="grid"
      />
    </div>
  );
}
