import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { parseLibrary } from "@/lib/subsonic";
import PlaylistsBrowser from "@/components/music/playlists-browser";

export const dynamic = "force-dynamic";

export default async function PlaylistsPage(props: {
  searchParams: Promise<{ library?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { library } = await props.searchParams;

  return <PlaylistsBrowser library={parseLibrary(library)} />;
}
