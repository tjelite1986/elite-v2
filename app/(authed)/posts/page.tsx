import { redirect } from "next/navigation";
import Link from "next/link";
import { Compass } from "lucide-react";
import { getSession } from "@/lib/auth";
import { ensureUserProfile } from "@/lib/profiles";
import PostFeed from "@/components/post-feed";

export const dynamic = "force-dynamic";

// Home feed: posts from the people/creators the viewer follows (plus their own).
export default async function PostsHomePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  ensureUserProfile(Number(session.sub), session.email);

  return (
    <div className="mx-auto max-w-md px-1 pb-24 pt-28 text-white">
      <PostFeed
        query={{ scope: "home" }}
        empty="Your feed is empty — follow people on Explore to see their posts here."
      />
      <div className="mt-6 text-center">
        <Link
          href="/posts/explore"
          className="inline-flex items-center gap-2 rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold transition hover:bg-white/15"
        >
          <Compass size={16} /> Discover more
        </Link>
      </div>
    </div>
  );
}
