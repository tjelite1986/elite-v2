"use client";

import Link from "next/link";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTime } from "@/components/video-player";

export interface VideoCardData {
  id: number;
  title: string;
  folder: string;
  duration: number | null;
  poster_key: string | null;
  views: number;
  added_at: string;
  percent?: number;
  position?: number;
}

export function relativeDate(iso: string): string {
  const then = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  const diff = Date.now() - then.getTime();
  if (!Number.isFinite(diff)) return "";
  const day = 86_400_000;
  if (diff < day) return "today";
  if (diff < 2 * day) return "yesterday";
  if (diff < 7 * day) return `${Math.floor(diff / day)} days ago`;
  if (diff < 30 * day) return `${Math.floor(diff / (7 * day))} weeks ago`;
  if (diff < 365 * day) return `${Math.floor(diff / (30 * day))} months ago`;
  return `${Math.floor(diff / (365 * day))} years ago`;
}

export function viewLabel(views: number): string {
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M views`;
  if (views >= 1000) return `${(views / 1000).toFixed(1)}K views`;
  return `${views} ${views === 1 ? "view" : "views"}`;
}

// One library tile. "grid" is the browse layout; "row" is the compact
// thumbnail-left form used by the up-next list beside the player.
export default function VideoCard({
  video,
  basePath,
  layout = "grid",
  active = false,
}: {
  video: VideoCardData;
  basePath: string;
  layout?: "grid" | "row";
  active?: boolean;
}) {
  const percent = video.percent ?? 0;
  const thumb = (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl bg-white/5",
        layout === "grid" ? "aspect-video w-full" : "aspect-video w-40 shrink-0"
      )}
    >
      {video.poster_key ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/videos/${video.id}/poster`}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
        />
      ) : (
        <div className="grid h-full w-full place-items-center text-white/20">
          <Play size={layout === "grid" ? 28 : 20} />
        </div>
      )}

      {video.duration ? (
        <span className="absolute bottom-1 right-1 rounded bg-black/85 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
          {formatTime(video.duration)}
        </span>
      ) : null}

      {percent > 0 && (
        <span className="absolute inset-x-0 bottom-0 h-1 bg-black/60">
          <span
            className="block h-full"
            style={{
              width: `${Math.min(100, percent)}%`,
              background: "var(--accent, #3b82f6)",
            }}
          />
        </span>
      )}
    </div>
  );

  return (
    <Link
      href={`${basePath}/${video.id}`}
      className={cn(
        "group block",
        layout === "row" && "flex gap-2.5 rounded-xl p-1 transition hover:bg-white/5",
        active && "bg-white/10"
      )}
    >
      {thumb}
      <div className={cn("min-w-0", layout === "grid" ? "mt-2" : "flex-1 py-0.5")}>
        <h3
          className={cn(
            "line-clamp-2 font-medium leading-snug text-white",
            layout === "grid" ? "text-sm" : "text-[13px]"
          )}
        >
          {video.title}
        </h3>
        <p className="mt-1 truncate text-xs text-white/40">
          {video.folder ? `${video.folder} · ` : ""}
          {viewLabel(video.views)} · {relativeDate(video.added_at)}
        </p>
      </div>
    </Link>
  );
}
