import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { parseLibrary } from "@/lib/subsonic";
import MusicHome from "@/components/music/music-home";

export const dynamic = "force-dynamic";

export default async function MusicPage(props: {
  searchParams: Promise<{ library?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { library } = await props.searchParams;

  return (
    <MusicHome
      library={parseLibrary(library)}
      isAdmin={session.role === "admin"}
    />
  );
}
