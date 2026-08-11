import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canAccessVideoChannel } from "@/lib/videos";
import { analysedSegments, analysedVideos } from "@/lib/video-summary";
import VideoAnalysis from "@/components/video-analysis";

export const dynamic = "force-dynamic";

// Same gate as the rest of the 18+ section: the analysis text describes the
// videos, so it must not be readable without the channel itself.
export default async function Video18AnalysisPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await canAccessVideoChannel("adults"))) notFound();

  return (
    <VideoAnalysis
      videos={analysedVideos("adults")}
      segments={analysedSegments("adults")}
      basePath="/videos18"
    />
  );
}
