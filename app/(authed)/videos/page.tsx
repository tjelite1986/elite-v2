import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import VideosBrowser from "@/components/videos-browser";

export const dynamic = "force-dynamic";

type Sort = "added" | "oldest" | "title" | "views" | "duration";
const SORTS: Sort[] = ["added", "oldest", "title", "views", "duration"];

// Long-form video library (main channel). Files live in VIDEOS_ROOT/main; the
// 18+ counterpart is the separate /videos18 section.
export default async function VideosPage(props: {
  searchParams: Promise<{ folder?: string; q?: string; sort?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const sp = await props.searchParams;
  const sort = SORTS.includes(sp.sort as Sort) ? (sp.sort as Sort) : "added";

  return (
    <VideosBrowser
      channel="main"
      basePath="/videos"
      title="Videos"
      isAdmin={session.role === "admin"}
      initialFolder={sp.folder || ""}
      initialQuery={sp.q || ""}
      initialSort={sort}
    />
  );
}
