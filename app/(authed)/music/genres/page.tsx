import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { parseLibrary } from "@/lib/subsonic";
import GenresBrowser from "@/components/music/genres-browser";

export const dynamic = "force-dynamic";

export default async function GenresPage(props: {
  searchParams: Promise<{ library?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { library } = await props.searchParams;

  return <GenresBrowser library={parseLibrary(library)} />;
}
