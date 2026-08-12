import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { parseLibrary } from "@/lib/subsonic";
import MusicSearch from "@/components/music/music-search";

export const dynamic = "force-dynamic";

export default async function MusicSearchPage(props: {
  searchParams: Promise<{ library?: string; q?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { library, q } = await props.searchParams;

  return <MusicSearch library={parseLibrary(library)} initialQuery={q || ""} />;
}
