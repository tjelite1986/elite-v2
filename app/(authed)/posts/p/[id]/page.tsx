import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getSession } from "@/lib/auth";
import { has18Access } from "@/lib/shorts-gate";
import { getPost } from "@/lib/posts";
import PostCard from "@/components/post-card";
import PostDeleteButton from "@/components/post-delete-button";
import PostReassignButton from "@/components/post-reassign-button";

export const dynamic = "force-dynamic";

// A single post permalink.
export default async function PostPermalinkPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const viewerId = Number(session.sub);

  const post = getPost(Number(params.id), viewerId);
  if (!post) notFound();
  if (post.is_adult && !(await has18Access())) {
    // Send adult content through the existing 18+ unlock flow.
    redirect("/shorts18");
  }

  const isAdmin = session.role === "admin";
  const canDelete =
    isAdmin || (post.author.type === "user" && post.author.id === viewerId);

  return (
    <div className="mx-auto max-w-md px-1 pb-24 pt-24 text-white">
      <div className="mb-2 flex items-center justify-between gap-3 px-2">
        <Link
          href="/posts"
          className="inline-flex items-center gap-1 text-sm text-white/60 hover:text-white"
        >
          <ChevronLeft size={16} /> Back
        </Link>
        <div className="flex items-center gap-4">
          {isAdmin && (
            <PostReassignButton
              postId={post.id}
              currentCreatorId={post.author.type === "creator" ? post.author.id : null}
            />
          )}
          {canDelete && <PostDeleteButton postId={post.id} />}
        </div>
      </div>
      <PostCard post={post} />
    </div>
  );
}
