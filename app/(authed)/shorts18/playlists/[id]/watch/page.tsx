import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { qb, getOne } from "@/lib/kysely";
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

  const pl = getOne<{ id: number }>(
    qb
      .selectFrom("short_playlists")
      .select("id")
      .where("id", "=", Number(params.id))
      .where("user_id", "=", Number(session.sub))
  );
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
