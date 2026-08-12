import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { parseLibrary } from "@/lib/subsonic";
import ArtistsBrowser from "@/components/music/artists-browser";

export const dynamic = "force-dynamic";

export default async function ArtistsPage(props: {
  searchParams: Promise<{ library?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { library } = await props.searchParams;

  return <ArtistsBrowser library={parseLibrary(library)} />;
}
