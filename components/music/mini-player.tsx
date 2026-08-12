"use client";

import { usePathname } from "next/navigation";
import { Loader2, ListMusic, Pause, Play, SkipForward, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { coverUrl } from "@/lib/music-client";
import { useMusicPlayer } from "@/components/music/player-provider";
import NowPlaying from "@/components/music/now-playing";

// The strip that sits directly above the global bottom nav whenever something
// is loaded. Tapping it opens the fullscreen now-playing view; the transport
// buttons stop the tap so they don't also expand.
//
// Rendered once, from app/(authed)/layout.tsx. The provider keeps --player-h in
// sync with whether this is showing, which is what BottomNav's bottom padding
// and every --fab-offset anchored control read.
export default function MiniPlayer() {
  const player = useMusicPlayer();
  const { current, playing, loading, position, duration, library } = player;
  const pathname = usePathname();

  // /messages runs its own exact-viewport shell with its own bottom bar; a
  // second fixed strip would sit on top of it. Playback continues regardless.
  const onMessages = pathname === "/messages" || pathname.startsWith("/messages/");

  if (!current || onMessages) return null;

  const art = coverUrl(current.coverArt, library, 96);
  const total = duration || current.duration || 0;
  const progress = total > 0 ? Math.min((position / total) * 100, 100) : 0;

  return (
    <>
      {/* z-40 matches the nav: fullscreen overlays (z-50+) still cover it. */}
      <div
        data-immersive-hide
        className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 border-t border-white/10 bg-black/80 backdrop-blur"
      >
        <div className="h-0.5 w-full bg-white/10">
          <div
            className="h-full bg-[var(--accent,#3b82f6)] transition-[width] duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div
          role="button"
          tabIndex={0}
          onClick={() => player.setExpanded(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") player.setExpanded(true);
          }}
          className="flex h-[3.25rem] cursor-pointer items-center gap-3 px-3"
        >
          <div className="h-9 w-9 shrink-0 overflow-hidden rounded bg-white/5">
            {art ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={art} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-white/20">
                <ListMusic size={16} />
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium leading-tight">
              {current.title}
            </p>
            <p className="truncate text-[11px] leading-tight text-white/45">
              {current.artist}
            </p>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              player.togglePlay();
            }}
            aria-label={playing ? "Pause" : "Play"}
            className="shrink-0 rounded-full p-2 text-white transition hover:bg-white/10"
          >
            {loading ? (
              <Loader2 size={20} className="animate-spin" />
            ) : playing ? (
              <Pause size={20} fill="currentColor" />
            ) : (
              <Play size={20} fill="currentColor" />
            )}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              player.next();
            }}
            aria-label="Next"
            className="shrink-0 rounded-full p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <SkipForward size={18} fill="currentColor" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              player.clearQueue();
            }}
            aria-label="Close player"
            className={cn(
              "shrink-0 rounded-full p-2 text-white/40 transition",
              "hover:bg-white/10 hover:text-white"
            )}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <NowPlaying />
    </>
  );
}
