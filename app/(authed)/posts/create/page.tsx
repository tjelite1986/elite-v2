import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ensureUserProfile } from "@/lib/profiles";
import PostComposer from "@/components/post-composer";

export const dynamic = "force-dynamic";

// Compose a new post.
export default async function PostsCreatePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  ensureUserProfile(Number(session.sub), session.email);

  return (
    <div className="mx-auto max-w-md px-4 pb-24 pt-24 text-white">
      <h1 className="mb-4 text-lg font-semibold">New post</h1>
      <PostComposer canFlagAdult />
    </div>
  );
}
