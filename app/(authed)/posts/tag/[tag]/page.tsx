import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ensureUserProfile } from "@/lib/profiles";
import PostGrid from "@/components/post-grid";

export const dynamic = "force-dynamic";

// All posts tagged with a hashtag.
export default async function PostsTagPage({
  params,
}: {
  params: { tag: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  ensureUserProfile(Number(session.sub), session.email);
  const tag = decodeURIComponent(params.tag).toLowerCase();

  return (
    <div className="mx-auto max-w-2xl px-1 pb-24 pt-24 text-white">
      <h1 className="mb-4 px-3 text-lg font-semibold">#{tag}</h1>
      <PostGrid query={{ scope: "tag", tag }} empty="No posts with this hashtag yet." />
    </div>
  );
}
