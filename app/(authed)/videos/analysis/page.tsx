import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { analysedSegments, analysedVideos } from "@/lib/video-summary";
import VideoAnalysis from "@/components/video-analysis";

export const dynamic = "force-dynamic";

export default async function VideoAnalysisPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <VideoAnalysis
      videos={analysedVideos("main")}
      segments={analysedSegments("main")}
      basePath="/videos"
    />
  );
}
