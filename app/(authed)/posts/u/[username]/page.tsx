import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Pencil } from "lucide-react";
import { getSession } from "@/lib/auth";
import { PostCreatorRow } from "@/lib/db";
import { qb, getOne } from "@/lib/kysely";
import { getProfileByUsername } from "@/lib/profiles";
import {
  followerCount,
  followingCount,
  isFollowing,
  postCountForUser,
  postCountForCreator,
} from "@/lib/posts";
import PostAvatar from "@/components/post-avatar";
import FollowButton from "@/components/follow-button";
import PostGrid from "@/components/post-grid";

export const dynamic = "force-dynamic";

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-center">
      <div className="text-base font-semibold text-white">{value}</div>
      <div className="text-xs text-white/50">{label}</div>
    </div>
  );
}

// Public profile for a user OR a mirrored creator, resolved by the shared
// username namespace. Shows header + a grid of the author's posts.
export default async function PostsProfilePage({
  params,
}: {
  params: { username: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const viewerId = Number(session.sub);
  const username = params.username.toLowerCase();

  const userProfile = getProfileByUsername(username);
  const creator = userProfile
    ? null
    : getOne<PostCreatorRow>(
        qb.selectFrom("post_creators").selectAll().where("username", "=", username)
      );

  if (!userProfile && !creator) notFound();

  const type: "user" | "creator" = userProfile ? "user" : "creator";
  const targetId = userProfile ? userProfile.user_id : creator!.id;
  const displayName = userProfile
    ? userProfile.display_name || userProfile.username
    : creator!.display_name || creator!.username;
  const bio = userProfile ? userProfile.bio : creator!.bio;
  const isOwn = type === "user" && targetId === viewerId;
  const postCount = userProfile
    ? postCountForUser(targetId)
    : postCountForCreator(targetId);

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-24 text-white">
      <header className="mb-6 flex items-start gap-5">
        <PostAvatar username={username} size={80} className="text-xl" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-lg font-semibold">@{username}</h1>
            {isOwn ? (
              <Link
                href="/posts/edit"
                className="flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-1.5 text-sm font-semibold transition hover:bg-white/15"
              >
                <Pencil size={14} /> Edit
              </Link>
            ) : (
              <FollowButton
                targetType={type}
                targetId={targetId}
                initialFollowing={isFollowing(viewerId, type, targetId)}
              />
            )}
          </div>
          <div className="mt-3 flex max-w-xs justify-between">
            <Stat value={postCount} label="posts" />
            <Stat value={followerCount(type, targetId)} label="followers" />
            <Stat value={type === "user" ? followingCount(targetId) : 0} label="following" />
          </div>
        </div>
      </header>

      {(displayName || bio) && (
        <div className="mb-5">
          {displayName && <div className="text-sm font-semibold">{displayName}</div>}
          {bio && <p className="mt-0.5 whitespace-pre-wrap text-sm text-white/80">{bio}</p>}
        </div>
      )}

      <PostGrid
        query={type === "user"
          ? { scope: "user", id: String(targetId) }
          : { scope: "creator", id: String(targetId) }}
        empty="No posts yet."
      />
    </div>
  );
}
