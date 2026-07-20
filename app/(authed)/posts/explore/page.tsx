import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ensureUserProfile } from "@/lib/profiles";
import PostViews from "@/components/post-views";
import PostSearch from "@/components/post-search";
import PostsImportButton from "@/components/posts-import-button";

export const dynamic = "force-dynamic";

// Explore: a grid of recent posts across everyone (adult posts appear only once
// the 18+ PIN is unlocked — the feed API enforces it).
export default async function PostsExplorePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  ensureUserProfile(Number(session.sub), session.email);

  return (
    // Full-bleed grid: 3 columns spanning the whole screen edge to edge.
    <div className="w-full pb-24 pt-6 text-white">
      <div className="px-1">
        <PostSearch />
      </div>
      {session.role === "admin" && (
        <div className="px-2">
          <PostsImportButton />
        </div>
      )}
      <PostViews
        query={{ scope: "explore" }}
        empty="No posts to explore yet."
        viewer={{ userId: Number(session.sub), isAdmin: session.role === "admin" }}
        storageKey="posts-view-explore"
        defaultView="grid"
      />
    </div>
  );
}
