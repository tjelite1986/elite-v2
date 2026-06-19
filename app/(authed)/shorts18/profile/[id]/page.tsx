import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, Download } from "lucide-react";
import { getSession } from "@/lib/auth";
import { getProfileSummary } from "@/lib/shorts";
import ShortsGrid from "@/components/shorts-grid";

export const dynamic = "force-dynamic";

// A single 18+ profile: header + a grid of its clips. Profiles from the main
// channel are never shown here (and vice-versa) so the two never mix.
export default async function Shorts18ProfilePage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const profile = getProfileSummary(Number(params.id));
  if (!profile) notFound();
  if (profile.channel !== "18plus") redirect("/shorts18/profiles");

  return (
    <div className="mx-auto max-w-5xl px-2 pb-24 pt-16 text-white">
      <div className="mb-4 flex items-center gap-2 px-1">
        <Link
          href="/shorts18/profiles"
          className="rounded-full bg-white/10 p-1.5 transition active:scale-90"
          aria-label="Back"
        >
          <ChevronLeft size={18} />
        </Link>
        <div className="flex-1">
          <div className="text-lg font-semibold">@{profile.name}</div>
          <div className="text-xs text-white/50">
            {profile.clip_count} clip{profile.clip_count === 1 ? "" : "s"}
          </div>
        </div>
        {session.role === "admin" && (
          <Link
            href={`/shorts18/profile/${profile.id}/candidates`}
            className="flex items-center gap-1.5 rounded-full bg-rose-500 px-4 py-2 text-sm font-semibold transition active:scale-95"
          >
            <Download size={16} /> Download
          </Link>
        )}
      </div>

      <ShortsGrid
        query={{ profile: String(profile.id) }}
        hrefPrefix={`/shorts18/profile/${profile.id}/watch?focus=`}
        empty="No clips for this profile yet."
        adminActions={session.role === "admin"}
        channel="18plus"
      />
    </div>
  );
}
