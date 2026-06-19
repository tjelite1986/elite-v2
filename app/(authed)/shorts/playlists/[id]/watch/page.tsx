import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import ShortsFeed from "@/components/shorts-feed";

export const dynamic = "force-dynamic";

// Immersive feed scoped to a playlist (opened from the playlist grid).
export default async function PlaylistWatchPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { focus?: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const pl = db
    .prepare("SELECT id FROM short_playlists WHERE id = ? AND user_id = ?")
    .get(Number(params.id), Number(session.sub)) as { id: number } | undefined;
  if (!pl) notFound();

  const focus = Number(searchParams?.focus);
  return (
    <ShortsFeed
      channel="main"
      playlistId={pl.id}
      focusId={focus && !isNaN(focus) ? focus : undefined}
    />
  );
}
