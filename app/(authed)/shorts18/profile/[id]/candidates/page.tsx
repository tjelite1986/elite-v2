import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getProfileSummary } from "@/lib/shorts";
import ShortsCandidates from "@/components/shorts-candidates";

export const dynamic = "force-dynamic";

// Admin-only manual download browser for one 18+ profile.
export default async function Profile18CandidatesPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect(`/shorts18/profile/${params.id}`);

  const profile = getProfileSummary(Number(params.id));
  if (!profile) notFound();
  if (profile.channel !== "18plus") redirect("/shorts18/profiles");

  return (
    <ShortsCandidates
      profileId={profile.id}
      profileName={profile.name}
      basePath="/shorts18"
    />
  );
}
