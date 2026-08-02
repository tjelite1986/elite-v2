import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getVideoWithState, relatedVideos } from "@/lib/videos";
import VideoWatch from "@/components/video-watch";

export const dynamic = "force-dynamic";

export default async function WatchPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const session = await getSession();
  if (!session) redirect("/login");

  const userId = Number(session.sub);
  const video = getVideoWithState(Number(id), userId);
  // A main-channel URL never plays 18+ content: the adults library has its own
  // gated section, and this page must not become a bypass for it.
  if (!video || video.channel !== "main") notFound();

  return (
    <VideoWatch
      video={video}
      related={relatedVideos(video, userId)}
      basePath="/videos"
      isAdmin={session.role === "admin"}
    />
  );
}
