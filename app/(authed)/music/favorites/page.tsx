import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { parseLibrary } from "@/lib/subsonic";
import FavoritesView from "@/components/music/favorites-view";

export const dynamic = "force-dynamic";

export default async function FavoritesPage(props: {
  searchParams: Promise<{ library?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { library } = await props.searchParams;

  return <FavoritesView library={parseLibrary(library)} />;
}
