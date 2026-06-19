import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ensureUserProfile } from "@/lib/profiles";
import PostGrid from "@/components/post-grid";
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
    <div className="mx-auto max-w-2xl px-1 pb-24 pt-24 text-white">
      <PostSearch />
      {session.role === "admin" && (
        <div className="px-2">
          <PostsImportButton />
        </div>
      )}
      <PostGrid query={{ scope: "explore" }} empty="No posts to explore yet." />
    </div>
  );
}
