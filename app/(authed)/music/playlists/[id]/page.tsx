import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { parseLibrary } from "@/lib/subsonic";
import PlaylistView from "@/components/music/playlist-view";

export const dynamic = "force-dynamic";

export default async function PlaylistPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ library?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await props.params;
  const { library } = await props.searchParams;

  return <PlaylistView playlistId={id} library={parseLibrary(library)} />;
}
