import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import DownloadsView from "@/components/music/downloads-view";

export const dynamic = "force-dynamic";

// Downloads live in the browser's Cache Storage, so this page has no server
// state at all — it only needs the session gate.
export default async function DownloadsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return <DownloadsView />;
}
