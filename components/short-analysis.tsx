"use client";

import Link from "next/link";
import { Clapperboard, Sparkles } from "lucide-react";

export interface AnalysedShortView {
  id: number;
  caption: string | null;
  duration: number | null;
  poster_key: string | null;
  ai_summary: string;
  ai_summary_tags: string | null;
  ai_summary_at: string | null;
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

function seconds(duration: number | null): string | null {
  if (!duration) return null;
  const s = Math.round(duration);
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s}s`;
}

// Reading view for the clip descriptions. Shorts are watched in a full-screen
// feed where long text has nowhere to go, so this is where the summaries are
// actually legible — and searchable by eye.
export default function ShortAnalysis({
  shorts,
  basePath,
}: {
  shorts: AnalysedShortView[];
  basePath: string;
}) {
  if (shorts.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <Sparkles size={28} className="mx-auto mb-3 text-white/25" />
        <h1 className="text-lg font-semibold">Nothing analysed yet</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-white/45">
          The hourly job describes new clips from their frames. Anything it
          writes shows up here.
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
        What the vision model made of these clips, read from their frames.
      </p>

      <div className="space-y-3">
        {shorts.map((short) => (
          <article
            key={short.id}
            className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3"
          >
            <Link
              href={`${basePath}?short=${short.id}`}
              className="relative aspect-[9/16] w-20 shrink-0 overflow-hidden rounded-lg bg-white/5"
            >
              {short.poster_key ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/shorts/${short.id}/poster`}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <span className="flex h-full items-center justify-center text-white/20">
                  <Clapperboard size={16} />
                </span>
              )}
              {seconds(short.duration) && (
                <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 text-[10px] font-medium">
                  {seconds(short.duration)}
                </span>
              )}
            </Link>

            <div className="min-w-0 flex-1">
              {short.caption?.trim() && (
                <p className="line-clamp-1 text-xs text-white/45">
                  {short.caption}
                </p>
              )}
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-white/75">
                {short.ai_summary}
              </p>
              {tagList(short.ai_summary_tags).length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {tagList(short.ai_summary_tags).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/60"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
