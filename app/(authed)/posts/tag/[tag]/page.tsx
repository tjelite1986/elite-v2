import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ensureUserProfile } from "@/lib/profiles";
import PostGrid from "@/components/post-grid";

export const dynamic = "force-dynamic";

// All posts tagged with a hashtag.
export default async function PostsTagPage(
  props: {
    params: Promise<{ tag: string }>;
  }
) {
  const params = await props.params;
  const session = await getSession();
  if (!session) redirect("/login");
  ensureUserProfile(Number(session.sub), session.email);
  const tag = decodeURIComponent(params.tag).toLowerCase();

  return (
    // Full-bleed like the feed, so grid tiles and single-column cards are the
    // same size here as everywhere else.
    <div className="w-full pb-24 pt-6 text-white">
      <h1 className="mb-4 px-3 text-lg font-semibold">#{tag}</h1>
      <PostGrid
        query={{ scope: "tag", tag }}
        empty="No posts with this hashtag yet."
        viewer={{ userId: Number(session.sub), isAdmin: session.role === "admin" }}
      />
    </div>
  );
}
