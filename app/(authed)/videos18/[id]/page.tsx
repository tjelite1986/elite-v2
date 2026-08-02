import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canAccessVideoChannel, getVideoWithState, relatedVideos } from "@/lib/videos";
import { parseMetadata } from "@/lib/video-metadata";
import { performersForVideo } from "@/lib/video-performers";
import VideoWatch from "@/components/video-watch";

export const dynamic = "force-dynamic";

export default async function Watch18Page(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const session = await getSession();
  if (!session) redirect("/login");

  const userId = Number(session.sub);
  const video = getVideoWithState(Number(id), userId);
  if (!video || video.channel !== "adults") notFound();
  // Belt and braces: the section layout already gates, but this page reads
  // adult content directly, so it re-checks rather than trusting the layout.
  if (!(await canAccessVideoChannel("adults"))) notFound();

  return (
    <VideoWatch
      video={{
        ...video,
        metadata: parseMetadata(video),
        cast: performersForVideo(video.id).map((p) => ({
          slug: p.slug,
          name: p.name,
          gender: p.gender,
          nationality: p.nationality,
          birthday: p.birthday,
          rating: p.rating,
          hasImage: Boolean(p.image_key),
        })),
      }}
      related={relatedVideos(video, userId)}
      basePath="/videos18"
      isAdmin={session.role === "admin"}
    />
  );
}
