import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import ShortsGrid from "@/components/shorts-grid";

export const dynamic = "force-dynamic";

interface PlaylistRow {
  id: number;
  name: string;
}

// A playlist within the 18+ section: header + grid of saved clips.
export default async function Playlist18Page({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const pl = db
    .prepare("SELECT id, name FROM short_playlists WHERE id = ? AND user_id = ?")
    .get(Number(params.id), Number(session.sub)) as PlaylistRow | undefined;
  if (!pl) notFound();

  return (
    <div className="mx-auto max-w-5xl px-2 pb-24 pt-16 text-white">
      <div className="mb-4 flex items-center gap-2 px-1">
        <Link
          href="/shorts18/playlists"
          className="rounded-full bg-white/10 p-1.5 transition active:scale-90"
          aria-label="Back"
        >
          <ChevronLeft size={18} />
        </Link>
        <div className="text-lg font-semibold">{pl.name}</div>
      </div>

      <ShortsGrid
        query={{ playlist: String(pl.id) }}
        hrefPrefix={`/shorts18/playlists/${pl.id}/watch?focus=`}
        empty="This playlist is empty. Tap the bookmark on a clip to add it."
      />
    </div>
  );
}
