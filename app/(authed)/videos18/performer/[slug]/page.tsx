import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canAccessVideoChannel } from "@/lib/videos";
import { getPerformer, performerVideos } from "@/lib/video-performers";
import PerformerProfile from "@/components/performer-profile";

export const dynamic = "force-dynamic";

export default async function PerformerPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await canAccessVideoChannel("adults"))) notFound();

  const performer = getPerformer(slug);
  if (!performer) notFound();

  const videos = performerVideos(slug, Number(session.sub)).map((v) => ({
    id: v.id,
    // The matched title is the one people recognise; the filename is a fallback.
    title: v.meta_title || v.title,
    folder: v.meta_studio || v.folder,
    duration: v.duration,
    poster_key: v.meta_poster_key || v.poster_key,
    views: v.views,
    added_at: v.added_at,
    percent: (v as { percent?: number }).percent ?? 0,
    playable: v.playable,
    transcode_status: v.transcode_status,
  }));

  return (
    <PerformerProfile
      performer={performer}
      videos={videos}
      isAdmin={session.role === "admin"}
    />
  );
}
