import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import ShortsFeed from "@/components/shorts-feed";

export const dynamic = "force-dynamic";

// Immersive feed scoped to a playlist, within the 18+ section.
export default async function Playlist18WatchPage({
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
      channel="18plus"
      basePath="/shorts18"
      playlistId={pl.id}
      focusId={focus && !isNaN(focus) ? focus : undefined}
      isAdmin={session.role === "admin"}
    />
  );
}
