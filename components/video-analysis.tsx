"use client";

import Link from "next/link";
import { Clapperboard, Sparkles } from "lucide-react";
import { formatTime } from "@/components/video-player";
import { relativeDate } from "@/components/video-card";

export interface AnalysedVideoView {
  id: number;
  title: string;
  folder: string | null;
  duration: number | null;
  poster_key: string | null;
  ai_summary: string;
  ai_summary_tags: string | null;
  ai_summary_model: string | null;
  ai_summary_at: string | null;
  segment_count: number;
}

export interface AnalysedSegmentView {
  id: number;
  video_id: number;
  from_seconds: number;
  to_seconds: number;
  summary: string;
  tags: string | null;
  created_at: string;
  title: string;
  poster_key: string | null;
}

function tagList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

// The reading view for everything the vision model has written: whole-video
// summaries first, then the hand-picked segment analyses. Read-only by design
// — describing happens on the video's own page, where the player is.
export default function VideoAnalysis({
  videos,
  segments,
  basePath,
}: {
  videos: AnalysedVideoView[];
  segments: AnalysedSegmentView[];
  basePath: string;
}) {
  if (videos.length === 0 && segments.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <Sparkles size={28} className="mx-auto mb-3 text-white/25" />
        <h1 className="text-lg font-semibold">Nothing analysed yet</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-white/45">
          Open a video and use <span className="text-white/70">Describe</span> to
          summarise the whole thing, or{" "}
          <span className="text-white/70">Analyse part</span> to describe one
          stretch of it. Everything written here shows up on this page.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-4">
      <h1 className="mb-1 flex items-center gap-2 text-xl font-bold">
        <Sparkles size={18} />
        Analysis
      </h1>
      <p className="mb-5 text-sm text-white/45">
        What the vision model made of the library, read from the storyboard
        frames.
      </p>

      {videos.length > 0 && (
        <section className="mb-8 space-y-3">
          {videos.map((video) => (
            <article
              key={video.id}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"
            >
              <div className="flex gap-3">
                <Link
                  href={`${basePath}/${video.id}`}
                  className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-lg bg-white/5"
                >
                  {video.poster_key ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/videos/${video.id}/poster`}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <span className="flex h-full items-center justify-center text-white/20">
                      <Clapperboard size={18} />
                    </span>
                  )}
                  {video.duration && (
                    <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 text-[10px] font-medium">
                      {formatTime(video.duration)}
                    </span>
                  )}
                </Link>

                <div className="min-w-0 flex-1">
                  <Link
                    href={`${basePath}/${video.id}`}
                    className="line-clamp-2 text-sm font-semibold leading-snug hover:underline"
                  >
                    {video.title}
                  </Link>
                  <p className="mt-0.5 text-[11px] text-white/35">
                    {[
                      video.ai_summary_at
                        ? relativeDate(video.ai_summary_at)
                        : null,
                      video.segment_count > 0
                        ? `${video.segment_count} part${video.segment_count === 1 ? "" : "s"} analysed`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </div>

              <p className="mt-2.5 whitespace-pre-wrap text-sm text-white/75">
                {video.ai_summary}
              </p>

              {tagList(video.ai_summary_tags).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {tagList(video.ai_summary_tags).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/60"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </article>
          ))}
        </section>
      )}

      {segments.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-white/80">
            Analysed parts
          </h2>
          <div className="space-y-2">
            {segments.map((seg) => (
              <article
                key={seg.id}
                className="rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`${basePath}/${seg.video_id}`}
                    className="text-sm font-medium hover:underline"
                  >
                    {seg.title}
                  </Link>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/60">
                    {formatTime(seg.from_seconds)}–{formatTime(seg.to_seconds)}
                  </span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-sm text-white/70">
                  {seg.summary}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
