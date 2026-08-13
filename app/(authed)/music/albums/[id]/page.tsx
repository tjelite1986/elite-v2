import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { parseLibrary } from "@/lib/subsonic";
import AlbumView from "@/components/music/album-view";

export const dynamic = "force-dynamic";

export default async function AlbumPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ library?: string; track?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await props.params;
  const { library, track } = await props.searchParams;

  return (
    <AlbumView
      albumId={id}
      library={parseLibrary(library)}
      highlightTrack={track ?? null}
    />
  );
}
