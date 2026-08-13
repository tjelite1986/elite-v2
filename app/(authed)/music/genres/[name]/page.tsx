import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { parseLibrary } from "@/lib/subsonic";
import GenreView from "@/components/music/genre-view";

export const dynamic = "force-dynamic";

export default async function GenrePage(props: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ library?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { name } = await props.params;
  const { library } = await props.searchParams;

  return (
    <GenreView genre={decodeURIComponent(name)} library={parseLibrary(library)} />
  );
}
