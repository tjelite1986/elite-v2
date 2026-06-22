import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getSession } from "@/lib/auth";
import { qb, getOne } from "@/lib/kysely";
import ShortsGrid from "@/components/shorts-grid";

export const dynamic = "force-dynamic";

interface PlaylistRow {
  id: number;
  name: string;
}

// A playlist: header + grid of saved clips. Tapping opens the immersive feed
// scoped to the playlist.
export default async function PlaylistPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const pl = getOne<PlaylistRow>(
    qb
      .selectFrom("short_playlists")
      .select(["id", "name"])
      .where("id", "=", Number(params.id))
      .where("user_id", "=", Number(session.sub))
  );
  if (!pl) notFound();

  return (
    <div className="mx-auto max-w-5xl px-2 pb-24 pt-16 text-white">
      <div className="mb-4 flex items-center gap-2 px-1">
        <Link
          href="/shorts/playlists"
          className="rounded-full bg-white/10 p-1.5 transition active:scale-90"
          aria-label="Back"
        >
          <ChevronLeft size={18} />
        </Link>
        <div className="text-lg font-semibold">{pl.name}</div>
      </div>

      <ShortsGrid
        query={{ playlist: String(pl.id) }}
        hrefPrefix={`/shorts/playlists/${pl.id}/watch?focus=`}
        empty="This playlist is empty. Tap the bookmark on a clip to add it."
      />
    </div>
  );
}
