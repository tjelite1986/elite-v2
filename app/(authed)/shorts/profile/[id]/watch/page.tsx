import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getProfileSummary } from "@/lib/shorts";
import ShortsFeed from "@/components/shorts-feed";

export const dynamic = "force-dynamic";

// Immersive feed scoped to one profile (opened from the profile grid).
export default async function ProfileWatchPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { focus?: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const profile = getProfileSummary(Number(params.id));
  if (!profile) notFound();
  // 18+ profiles are watched in the separate /shorts18 section.
  if (profile.channel === "18plus") {
    redirect(`/shorts18/profile/${profile.id}/watch`);
  }

  const focus = Number(searchParams?.focus);
  return (
    <ShortsFeed
      channel={profile.channel}
      profileId={profile.id}
      focusId={focus && !isNaN(focus) ? focus : undefined}
    />
  );
}
