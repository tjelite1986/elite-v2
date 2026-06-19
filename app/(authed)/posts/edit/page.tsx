import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getSession } from "@/lib/auth";
import { ensureUserProfile } from "@/lib/profiles";
import PostProfileEditor from "@/components/post-profile-editor";

export const dynamic = "force-dynamic";

// Edit the viewer's shared public profile (used across the posts module).
export default async function PostsEditProfilePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const profile = ensureUserProfile(Number(session.sub), session.email);

  return (
    <div className="mx-auto max-w-md px-4 pb-24 pt-24 text-white">
      <div className="mb-4 flex items-center gap-2">
        <Link
          href={`/posts/u/${profile.username}`}
          className="inline-flex items-center gap-1 text-sm text-white/60 hover:text-white"
        >
          <ChevronLeft size={16} /> Back
        </Link>
      </div>
      <h1 className="mb-5 text-lg font-semibold">Edit profile</h1>
      <PostProfileEditor
        initial={{
          username: profile.username,
          display_name: profile.display_name,
          bio: profile.bio,
        }}
      />
    </div>
  );
}
