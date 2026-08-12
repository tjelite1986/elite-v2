import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { parseLibrary } from "@/lib/subsonic";
import ArtistView from "@/components/music/artist-view";

export const dynamic = "force-dynamic";

export default async function ArtistPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ library?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await props.params;
  const { library } = await props.searchParams;

  return <ArtistView artistId={id} library={parseLibrary(library)} />;
}
