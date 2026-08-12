import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { parseLibrary } from "@/lib/subsonic";
import AlbumsBrowser from "@/components/music/albums-browser";

export const dynamic = "force-dynamic";

export default async function AlbumsPage(props: {
  searchParams: Promise<{ library?: string; sort?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { library, sort } = await props.searchParams;

  return <AlbumsBrowser library={parseLibrary(library)} sort={sort || "name"} />;
}
