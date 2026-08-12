"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  Heart,
  ListMusic,
  Mic2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useBackDismiss } from "@/lib/use-back-dismiss";
import { coverUrl, formatDuration, musicFetch } from "@/lib/music-client";
import { useMusicPlayer } from "@/components/music/player-provider";

interface LyricLine {
  start: number | null;
  value: string;
}

// Fullscreen "now playing": artwork, scrubber, transport, and a bottom panel
// that switches between the queue and the song's lyrics.
export default function NowPlaying() {
  const player = useMusicPlayer();
  const {
    current,
    library,
    queue,
    index,
    playing,
    position,
    duration,
    shuffle,
    repeat,
    muted,
    volume,
    expanded,
  } = player;

  const [panel, setPanel] = useState<"queue" | "lyrics">("queue");
  const [lyrics, setLyrics] = useState<{ synced: boolean; lines: LyricLine[] } | null>(
    null
  );
  const [lyricsState, setLyricsState] = useState<"idle" | "loading" | "none">("idle");
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const [starBusy, setStarBusy] = useState(false);

  const close = useCallback(() => player.setExpanded(false), [player]);
  useBackDismiss(expanded, close);

  // Lyrics are fetched per song, and only while the panel is actually open —
  // an LRCLIB lookup for every track someone skips past is wasted traffic.
  useEffect(() => {
    if (!expanded || panel !== "lyrics" || !current) return;
    let cancelled = false;
    setLyricsState("loading");
    setLyrics(null);
    musicFetch<{ lyrics: { synced: boolean; lines: LyricLine[] } | null }>(
      `/api/music/lyrics?id=${encodeURIComponent(current.id)}`,
      library
    )
      .then((data) => {
        if (cancelled) return;
        if (data.lyrics?.lines?.length) {
          setLyrics(data.lyrics);
          setLyricsState("idle");
        } else {
          setLyricsState("none");
        }
      })
      .catch(() => !cancelled && setLyricsState("none"));
    return () => {
      cancelled = true;
    };
  }, [expanded, panel, current, library]);

  // Follow the synced line as it plays.
  const activeLine = (() => {
    if (!lyrics?.synced) return -1;
    let hit = -1;
    for (let i = 0; i < lyrics.lines.length; i++) {
      const start = lyrics.lines[i].start;
      if (start != null && start / 1000 <= position) hit = i;
      else break;
    }
    return hit;
  })();

  const lineRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  useEffect(() => {
    if (activeLine < 0) return;
    lineRefs.current[activeLine]?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }, [activeLine]);

  const toggleStar = useCallback(async () => {
    if (!current || starBusy) return;
    setStarBusy(true);
    const next = !current.starred;
    try {
      await musicFetch("/api/music/star", library, {
        method: "POST",
        body: JSON.stringify({ id: current.id, type: "song", starred: next }),
      });
      player.markStarred(current.id, next);
    } catch {
      /* leave the heart as it was */
    } finally {
      setStarBusy(false);
    }
  }, [current, library, player, starBusy]);

  if (!expanded || !current) return null;

  const art = coverUrl(current.coverArt, library, 800);
  const shown = scrubbing ?? position;
  const total = duration || current.duration || 0;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-gradient-to-b from-[#1b1b24] via-[#111116] to-black">
      <header className="flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-2">
        <button
          onClick={close}
          aria-label="Close"
          className="rounded-full p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
        >
          <ChevronDown size={22} />
        </button>
        <span className="text-xs uppercase tracking-wider text-white/40">
          {library === "kids" ? "Kids library" : "Playing from library"}
        </span>
        <button
          onClick={toggleStar}
          aria-label={current.starred ? "Remove from favourites" : "Add to favourites"}
          className={cn(
            "rounded-full p-2 transition hover:bg-white/10",
            current.starred ? "text-rose-400" : "text-white/70 hover:text-white"
          )}
        >
          <Heart size={20} fill={current.starred ? "currentColor" : "none"} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col px-5">
        <div className="mx-auto w-full max-w-sm shrink-0">
          <div className="aspect-square w-full overflow-hidden rounded-2xl bg-white/5 shadow-2xl">
            {art ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={art}
                alt=""
                className="h-full w-full object-cover"
                draggable={false}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-white/20">
                <ListMusic size={64} />
              </div>
            )}
          </div>

          <div className="mt-5 text-center">
            <h1 className="truncate text-lg font-semibold">{current.title}</h1>
            {current.artistId ? (
              <Link
                href={`/music/artists/${encodeURIComponent(current.artistId)}?library=${library}`}
                onClick={close}
                className="mt-0.5 block truncate text-sm text-white/50 transition hover:text-white/80"
              >
                {current.artist}
              </Link>
            ) : (
              <p className="mt-0.5 truncate text-sm text-white/50">{current.artist}</p>
            )}
          </div>

          {/* Scrubber. The displayed value follows the drag, and the seek only
              happens on release, so dragging doesn't fight timeupdate. */}
          <div className="mt-5">
            <input
              type="range"
              min={0}
              max={Math.max(total, 1)}
              step={1}
              value={Math.min(shown, total || 1)}
              onChange={(e) => setScrubbing(Number(e.target.value))}
              onPointerUp={() => {
                if (scrubbing != null) player.seek(scrubbing);
                setScrubbing(null);
              }}
              onKeyUp={() => {
                if (scrubbing != null) player.seek(scrubbing);
                setScrubbing(null);
              }}
              aria-label="Seek"
              className="w-full accent-[var(--accent,#3b82f6)]"
            />
            <div className="flex justify-between text-[11px] tabular-nums text-white/40">
              <span>{formatDuration(shown)}</span>
              <span>{formatDuration(total)}</span>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <button
              onClick={player.toggleShuffle}
              aria-label="Shuffle"
              className={cn(
                "rounded-full p-2 transition hover:bg-white/10",
                shuffle ? "text-[var(--accent,#3b82f6)]" : "text-white/50"
              )}
            >
              <Shuffle size={20} />
            </button>
            <button
              onClick={player.previous}
              aria-label="Previous"
              className="rounded-full p-2 text-white/80 transition hover:bg-white/10 hover:text-white"
            >
              <SkipBack size={28} fill="currentColor" />
            </button>
            <button
              onClick={player.togglePlay}
              aria-label={playing ? "Pause" : "Play"}
              className="rounded-full bg-white p-4 text-black transition hover:scale-105"
            >
              {playing ? (
                <Pause size={26} fill="currentColor" />
              ) : (
                <Play size={26} fill="currentColor" className="translate-x-0.5" />
              )}
            </button>
            <button
              onClick={player.next}
              aria-label="Next"
              className="rounded-full p-2 text-white/80 transition hover:bg-white/10 hover:text-white"
            >
              <SkipForward size={28} fill="currentColor" />
            </button>
            <button
              onClick={player.cycleRepeat}
              aria-label={`Repeat: ${repeat}`}
              className={cn(
                "rounded-full p-2 transition hover:bg-white/10",
                repeat === "off" ? "text-white/50" : "text-[var(--accent,#3b82f6)]"
              )}
            >
              {repeat === "one" ? <Repeat1 size={20} /> : <Repeat size={20} />}
            </button>
          </div>

          {/* Volume is pointless on phones (the hardware keys own it) but the
              app is used on a desktop too. */}
          <div className="mt-3 hidden items-center gap-2 sm:flex">
            <button
              onClick={player.toggleMute}
              aria-label={muted ? "Unmute" : "Mute"}
              className="text-white/50 transition hover:text-white"
            >
              {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(e) => player.setVolume(Number(e.target.value))}
              aria-label="Volume"
              className="w-32 accent-[var(--accent,#3b82f6)]"
            />
          </div>
        </div>

        <div className="mt-5 flex shrink-0 items-center gap-2 border-b border-white/10">
          {(
            [
              { id: "queue" as const, label: "Up next", icon: ListMusic },
              { id: "lyrics" as const, label: "Lyrics", icon: Mic2 },
            ]
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setPanel(id)}
              className={cn(
                "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition",
                panel === id
                  ? "border-white text-white"
                  : "border-transparent text-white/40 hover:text-white/70"
              )}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
          {panel === "queue" && queue.length > 0 && (
            <button
              onClick={player.clearQueue}
              className="ml-auto flex items-center gap-1 px-2 py-1 text-xs text-white/40 transition hover:text-rose-400"
            >
              <Trash2 size={13} />
              Clear
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          {panel === "queue" ? (
            <ul className="divide-y divide-white/5">
              {queue.map((song, i) => (
                <li
                  key={`${song.id}-${i}`}
                  className={cn(
                    "flex items-center gap-3 py-2",
                    i === index && "text-[var(--accent,#3b82f6)]"
                  )}
                >
                  <button
                    onClick={() => player.jumpTo(i)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-sm">{song.title}</span>
                    <span className="block truncate text-xs text-white/40">
                      {song.artist}
                    </span>
                  </button>
                  <span className="shrink-0 text-xs tabular-nums text-white/30">
                    {formatDuration(song.duration)}
                  </span>
                  <button
                    onClick={() => player.removeAt(i)}
                    aria-label="Remove from queue"
                    className="shrink-0 rounded p-1 text-white/30 transition hover:text-rose-400"
                  >
                    <X size={15} />
                  </button>
                </li>
              ))}
            </ul>
          ) : lyricsState === "loading" ? (
            <p className="py-8 text-center text-sm text-white/40">Loading lyrics…</p>
          ) : lyrics ? (
            <div className="py-4">
              {lyrics.lines.map((line, i) => (
                <p
                  key={i}
                  ref={(el) => {
                    lineRefs.current[i] = el;
                  }}
                  className={cn(
                    "py-1 text-center text-[15px] transition",
                    lyrics.synced && i === activeLine
                      ? "font-semibold text-white"
                      : "text-white/35"
                  )}
                >
                  {line.value || " "}
                </p>
              ))}
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-white/40">
              No lyrics found for this track.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
