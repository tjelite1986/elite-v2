import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { qb, getOne } from "@/lib/kysely";
import ShortsFeed from "@/components/shorts-feed";

export const dynamic = "force-dynamic";

// Immersive feed scoped to a playlist (opened from the playlist grid).
export default async function PlaylistWatchPage(
  props: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ focus?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
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
      channel="main"
      playlistId={pl.id}
      focusId={focus && !isNaN(focus) ? focus : undefined}
      isAdmin={session.role === "admin"}
      viewerId={Number(session?.sub) || 0}
    />
  );
}
