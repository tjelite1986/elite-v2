"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Check,
  Gauge,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  RectangleHorizontal,
  RotateCcw,
  RotateCw,
  Settings,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useBackDismiss } from "@/lib/use-back-dismiss";

// ---------------------------------------------------------------------------
// YouTube-style player for the long-form video library. Everything is custom
// (the native controls are off) so the surface matches the rest of the app:
// hover/scrub storyboard previews, buffered-range bar, speed menu, theater and
// fullscreen modes, PiP, double-tap seek, and the full keyboard map.
// ---------------------------------------------------------------------------

export interface PlayerVideo {
  id: number;
  title: string;
  duration: number | null;
  poster_key: string | null;
  storyboard_key: string | null;
  storyboard_cols: number | null;
  storyboard_rows: number | null;
  storyboard_interval: number | null;
  storyboard_tile_w: number | null;
  storyboard_tile_h: number | null;
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const HIDE_DELAY = 2800;

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return h > 0
    ? `${h}:${mm}:${String(s).padStart(2, "0")}`
    : `${mm}:${String(s).padStart(2, "0")}`;
}

export default function VideoPlayer({
  video,
  startAt = 0,
  autoPlay = false,
  theater = false,
  onToggleTheater,
  onEnded,
  onNext,
  onProgress,
  onFirstPlay,
}: {
  video: PlayerVideo;
  startAt?: number;
  autoPlay?: boolean;
  theater?: boolean;
  onToggleTheater?: () => void;
  onEnded?: () => void;
  onNext?: () => void;
  onProgress?: (position: number) => void;
  onFirstPlay?: () => void;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [current, setCurrent] = useState(startAt);
  const [duration, setDuration] = useState(video.duration ?? 0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scrub, setScrub] = useState<{ time: number; x: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [seekFlash, setSeekFlash] = useState<"back" | "forward" | null>(null);

  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTap = useRef<{ at: number; side: "back" | "forward" } | null>(null);
  const viewCounted = useRef(false);
  const resumeApplied = useRef(false);
  // Last known playback position, mirrored outside React state: on unmount the
  // <video> ref is already detached, so the final progress save reads this.
  const positionRef = useRef(startAt);

  const streamSrc = `/api/videos/${video.id}/stream`;
  const posterSrc = video.poster_key ? `/api/videos/${video.id}/poster` : undefined;

  // Back button closes the settings popover instead of leaving the page.
  useBackDismiss(settingsOpen, () => setSettingsOpen(false));

  // --- playback helpers ---------------------------------------------------

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      // Never hide while a menu is open or the video is paused — the user is
      // looking at the controls in both cases.
      if (videoRef.current && !videoRef.current.paused) {
        setControlsVisible(false);
      }
    }, HIDE_DELAY);
  }, []);

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play().catch(() => setFailed(true));
    } else {
      el.pause();
    }
    showControls();
  }, [showControls]);

  const seekBy = useCallback(
    (delta: number) => {
      const el = videoRef.current;
      if (!el) return;
      el.currentTime = Math.min(
        Math.max(0, el.currentTime + delta),
        el.duration || Number.MAX_SAFE_INTEGER
      );
      setSeekFlash(delta < 0 ? "back" : "forward");
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setSeekFlash(null), 500);
      showControls();
    },
    [showControls]
  );

  const seekTo = useCallback((time: number) => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = Math.min(Math.max(0, time), el.duration || time);
    setCurrent(el.currentTime);
  }, []);

  const changeVolume = useCallback(
    (value: number) => {
      const el = videoRef.current;
      if (!el) return;
      const v = Math.min(1, Math.max(0, value));
      el.volume = v;
      el.muted = v === 0;
      setVolume(v);
      setMuted(v === 0);
      try {
        localStorage.setItem("videos_volume", String(v));
      } catch {
        /* private mode — volume just isn't remembered */
      }
      showControls();
    },
    [showControls]
  );

  const toggleMute = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
    showControls();
  }, [showControls]);

  const toggleFullscreen = useCallback(() => {
    const shell = shellRef.current;
    if (!shell) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void shell.requestFullscreen?.().catch(() => {});
    }
  }, []);

  const togglePip = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (document.pictureInPictureElement) {
      void document.exitPictureInPicture().catch(() => {});
    } else {
      void el.requestPictureInPicture?.().catch(() => {});
    }
  }, []);

  const applySpeed = useCallback((value: number) => {
    const el = videoRef.current;
    if (!el) return;
    el.playbackRate = value;
    setSpeed(value);
  }, []);

  // --- element wiring -----------------------------------------------------

  // Restore the remembered volume once, before the first play.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    try {
      const saved = Number(localStorage.getItem("videos_volume"));
      if (Number.isFinite(saved) && saved >= 0 && saved <= 1) {
        el.volume = saved;
        setVolume(saved);
        setMuted(saved === 0);
      }
    } catch {
      /* keep the default volume */
    }
  }, []);

  // A new video in the same mounted player (autoplay-next) must not inherit the
  // previous one's resume position or view flag.
  useEffect(() => {
    resumeApplied.current = false;
    viewCounted.current = false;
    positionRef.current = startAt;
    setCurrent(startAt);
    setFailed(false);
    setDuration(video.duration ?? 0);
  }, [video.id, video.duration, startAt]);

  useEffect(() => {
    const onFsChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // Keyboard map, scoped to the page (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      const el = videoRef.current;
      if (!el) return;
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "j":
          seekBy(-10);
          break;
        case "l":
          seekBy(10);
          break;
        case "ArrowLeft":
          e.preventDefault();
          seekBy(-5);
          break;
        case "ArrowRight":
          e.preventDefault();
          seekBy(5);
          break;
        case "ArrowUp":
          e.preventDefault();
          changeVolume(el.volume + 0.05);
          break;
        case "ArrowDown":
          e.preventDefault();
          changeVolume(el.volume - 0.05);
          break;
        case "m":
          toggleMute();
          break;
        case "f":
          toggleFullscreen();
          break;
        case "t":
          onToggleTheater?.();
          break;
        case "n":
          onNext?.();
          break;
        case ",":
          applySpeed(SPEEDS[Math.max(0, SPEEDS.indexOf(speed) - 1)] ?? speed);
          break;
        case ".":
          applySpeed(
            SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(speed) + 1)] ??
              speed
          );
          break;
        default:
          // 0-9 jump to that tenth of the video, like YouTube.
          if (/^[0-9]$/.test(e.key) && el.duration) {
            seekTo((Number(e.key) / 10) * el.duration);
          }
          return;
      }
      showControls();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    applySpeed,
    changeVolume,
    onNext,
    onToggleTheater,
    seekBy,
    seekTo,
    showControls,
    speed,
    togglePlay,
    toggleFullscreen,
    toggleMute,
  ]);

  // Report the position on a timer while playing, and once more on unmount, so
  // a resume point survives a hard tab close.
  useEffect(() => {
    if (!onProgress) return;
    const timer = setInterval(() => {
      const el = videoRef.current;
      if (el && !el.paused && el.currentTime > 0) onProgress(el.currentTime);
    }, 10000);
    return () => {
      clearInterval(timer);
      if (positionRef.current > 0) onProgress(positionRef.current);
    };
  }, [onProgress]);

  // A full-page navigation (or closing the tab) tears the document down without
  // running React cleanups, so the timer above would lose everything watched
  // since its last tick. pagehide/visibilitychange are the only hooks that
  // still fire there — the POST itself goes out with keepalive.
  useEffect(() => {
    if (!onProgress) return;
    const flush = () => {
      if (positionRef.current > 0) onProgress(positionRef.current);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [onProgress]);

  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    []
  );

  // --- seek bar -----------------------------------------------------------

  const timeFromClientX = useCallback(
    (clientX: number): number => {
      const bar = barRef.current;
      if (!bar || !duration) return 0;
      const rect = bar.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return ratio * duration;
    },
    [duration]
  );

  const onBarPointerDown = (e: React.PointerEvent) => {
    if (!duration) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDragging(true);
    seekTo(timeFromClientX(e.clientX));
  };

  const onBarPointerMove = (e: React.PointerEvent) => {
    if (!duration) return;
    const bar = barRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const time = timeFromClientX(e.clientX);
    setScrub({
      time,
      x: Math.min(Math.max(e.clientX - rect.left, 0), rect.width),
    });
    if (dragging) seekTo(time);
  };

  const onBarPointerUp = (e: React.PointerEvent) => {
    if (!dragging) return;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    setDragging(false);
    seekTo(timeFromClientX(e.clientX));
  };

  // Storyboard sprite geometry for the scrub preview (null when the video has
  // no sheet — the tooltip then shows just the timestamp).
  const storyboard = useMemo(() => {
    const {
      storyboard_key: key,
      storyboard_cols: cols,
      storyboard_rows: rows,
      storyboard_interval: interval,
      storyboard_tile_w: tileW,
      storyboard_tile_h: tileH,
    } = video;
    if (!key || !cols || !rows || !interval || !tileW || !tileH) return null;
    return { cols, rows, interval, tileW, tileH };
  }, [video]);

  const scrubTileStyle = useMemo(() => {
    if (!storyboard || !scrub) return null;
    const { cols, rows, interval, tileW, tileH } = storyboard;
    const index = Math.min(
      cols * rows - 1,
      Math.max(0, Math.floor(scrub.time / interval))
    );
    return {
      width: tileW,
      height: tileH,
      backgroundImage: `url(/api/videos/${video.id}/poster?storyboard=1)`,
      backgroundSize: `${cols * tileW}px ${rows * tileH}px`,
      backgroundPosition: `-${(index % cols) * tileW}px -${
        Math.floor(index / cols) * tileH
      }px`,
    } as React.CSSProperties;
  }, [scrub, storyboard, video.id]);

  // --- surface gestures ---------------------------------------------------

  // Tap toggles play; a second tap on the same half within 300 ms seeks ±10 s
  // (the mobile YouTube gesture) instead of pausing.
  const onSurfaceClick = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const side: "back" | "forward" =
      e.clientX - rect.left < rect.width / 2 ? "back" : "forward";
    const now = Date.now();
    if (lastTap.current && now - lastTap.current.at < 300) {
      lastTap.current = null;
      seekBy(side === "back" ? -10 : 10);
      return;
    }
    lastTap.current = { at: now, side };
    setTimeout(() => {
      if (lastTap.current && Date.now() - lastTap.current.at >= 290) {
        lastTap.current = null;
        togglePlay();
      }
    }, 300);
  };

  const played = duration ? (current / duration) * 100 : 0;
  const bufferedPct = duration ? (buffered / duration) * 100 : 0;
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div
      ref={shellRef}
      className={cn(
        "group relative w-full select-none overflow-hidden bg-black",
        fullscreen ? "h-screen" : theater ? "aspect-[21/9]" : "aspect-video",
        !controlsVisible && playing && "cursor-none"
      )}
      onMouseMove={showControls}
      onMouseLeave={() => playing && setControlsVisible(false)}
    >
      <video
        ref={videoRef}
        src={streamSrc}
        poster={posterSrc}
        className="h-full w-full bg-black object-contain"
        playsInline
        preload="metadata"
        autoPlay={autoPlay}
        onClick={(e) => e.preventDefault()}
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          if (Number.isFinite(el.duration) && el.duration > 0) {
            setDuration(el.duration);
          }
          // Resume once per video: seeking on every metadata event (which fires
          // again on some seeks) would yank the viewer back to the start point.
          if (!resumeApplied.current && startAt > 2) {
            resumeApplied.current = true;
            el.currentTime = startAt;
          }
          el.playbackRate = speed;
        }}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          setCurrent(el.currentTime);
          positionRef.current = el.currentTime;
          if (!viewCounted.current && el.currentTime > 5) {
            viewCounted.current = true;
            onFirstPlay?.();
          }
        }}
        onProgress={(e) => {
          const el = e.currentTarget;
          if (el.buffered.length) {
            setBuffered(el.buffered.end(el.buffered.length - 1));
          }
        }}
        onPlay={() => {
          setPlaying(true);
          setFailed(false);
          showControls();
        }}
        onPause={(e) => {
          setPlaying(false);
          setControlsVisible(true);
          // Pausing is a natural "leave here" point — persist it immediately
          // instead of waiting for the next timer tick.
          if (e.currentTarget.currentTime > 0) {
            onProgress?.(e.currentTarget.currentTime);
          }
        }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onEnded={() => {
          setPlaying(false);
          setControlsVisible(true);
          onEnded?.();
        }}
        onError={() => {
          setFailed(true);
          setWaiting(false);
        }}
      />

      {/* Click/tap surface. Sits under the controls so buttons still work. */}
      <div className="absolute inset-0" onClick={onSurfaceClick} />

      {/* Buffering spinner */}
      {waiting && !failed && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <Loader2 className="animate-spin text-white/80" size={44} />
        </div>
      )}

      {/* Big center play button while paused */}
      {!playing && !waiting && !failed && (
        <button
          onClick={togglePlay}
          aria-label="Play"
          className="absolute left-1/2 top-1/2 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white ring-1 ring-white/15 backdrop-blur transition hover:bg-black/75 sm:size-20"
        >
          <Play size={30} className="ml-1 fill-white" />
        </button>
      )}

      {/* Double-tap seek feedback */}
      {seekFlash && (
        <div
          className={cn(
            "pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-4 text-white",
            seekFlash === "back" ? "left-[12%]" : "right-[12%]"
          )}
        >
          {seekFlash === "back" ? <RotateCcw size={26} /> : <RotateCw size={26} />}
        </div>
      )}

      {failed && (
        <div className="absolute inset-0 grid place-items-center bg-black/80 px-6 text-center text-sm text-white/70">
          <div>
            <p className="font-medium text-white">This video can&apos;t be played.</p>
            <p className="mt-1">
              The browser may not support this container or codec. Try
              downloading it instead.
            </p>
          </div>
        </div>
      )}

      {/* ---- controls ---- */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-2 pb-1.5 pt-10 transition-opacity duration-200 sm:px-3",
          controlsVisible || !playing
            ? "opacity-100"
            : "pointer-events-none opacity-0"
        )}
      >
        {/* Seek bar */}
        <div
          ref={barRef}
          onPointerDown={onBarPointerDown}
          onPointerMove={onBarPointerMove}
          onPointerUp={onBarPointerUp}
          onPointerLeave={() => !dragging && setScrub(null)}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(current)}
          tabIndex={0}
          className="group/bar relative mx-1 cursor-pointer py-2.5"
        >
          <div className="relative h-1 w-full rounded-full bg-white/25 transition-all group-hover/bar:h-1.5">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-white/35"
              style={{ width: `${bufferedPct}%` }}
            />
            <div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{
                width: `${played}%`,
                background: "var(--accent, #3b82f6)",
              }}
            />
            <div
              className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0 transition-opacity group-hover/bar:opacity-100"
              style={{
                left: `${played}%`,
                background: "var(--accent, #3b82f6)",
                opacity: dragging ? 1 : undefined,
              }}
            />
          </div>

          {/* Scrub preview: storyboard tile + timestamp */}
          {scrub && (
            <div
              className="pointer-events-none absolute bottom-7 z-10 -translate-x-1/2"
              style={{ left: scrub.x }}
            >
              {scrubTileStyle && (
                <div
                  className="mb-1 rounded border border-white/20 bg-black shadow-lg"
                  style={scrubTileStyle}
                />
              )}
              <div className="rounded bg-black/85 px-1.5 py-0.5 text-center text-[11px] font-medium text-white">
                {formatTime(scrub.time)}
              </div>
            </div>
          )}
        </div>

        {/* Button row */}
        <div className="flex items-center gap-1 text-white">
          <ControlButton onClick={togglePlay} label={playing ? "Pause" : "Play"}>
            {playing ? <Pause size={20} className="fill-white" /> : <Play size={20} className="fill-white" />}
          </ControlButton>

          {onNext && (
            <ControlButton onClick={onNext} label="Next video">
              <SkipForward size={19} className="fill-white" />
            </ControlButton>
          )}

          {/* Volume: button + slider that expands on hover (desktop) */}
          <div className="group/vol flex items-center">
            <ControlButton onClick={toggleMute} label={muted ? "Unmute" : "Mute"}>
              <VolumeIcon size={20} />
            </ControlButton>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(e) => changeVolume(Number(e.target.value))}
              aria-label="Volume"
              className="h-1 w-0 cursor-pointer appearance-none rounded-full bg-white/30 opacity-0 transition-all duration-200 accent-white group-hover/vol:w-16 group-hover/vol:opacity-100 focus:w-16 focus:opacity-100"
            />
          </div>

          <span className="ml-1 select-none text-xs tabular-nums text-white/90">
            {formatTime(current)} / {formatTime(duration)}
          </span>

          <div className="ml-auto flex items-center gap-1">
            {/* Settings: playback speed */}
            <div className="relative">
              <ControlButton
                onClick={() => setSettingsOpen((v) => !v)}
                label="Settings"
                active={settingsOpen}
              >
                <Settings size={19} />
              </ControlButton>
              {settingsOpen && (
                <div className="absolute bottom-11 right-0 z-20 w-40 overflow-hidden rounded-xl border border-white/10 bg-neutral-900/95 py-1 text-sm shadow-2xl backdrop-blur">
                  <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] uppercase tracking-wide text-white/40">
                    <Gauge size={13} /> Playback speed
                  </div>
                  {SPEEDS.map((value) => (
                    <button
                      key={value}
                      onClick={() => {
                        applySpeed(value);
                        setSettingsOpen(false);
                      }}
                      className="flex w-full items-center justify-between px-3 py-1.5 text-left transition hover:bg-white/10"
                    >
                      <span>{value === 1 ? "Normal" : `${value}×`}</span>
                      {speed === value && <Check size={14} />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <ControlButton onClick={togglePip} label="Picture in picture" className="hidden sm:inline-flex">
              <PictureInPicture2 size={19} />
            </ControlButton>

            {onToggleTheater && (
              <ControlButton
                onClick={onToggleTheater}
                label="Theater mode"
                active={theater}
                className="hidden sm:inline-flex"
              >
                <RectangleHorizontal size={19} />
              </ControlButton>
            )}

            <ControlButton
              onClick={toggleFullscreen}
              label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}
            </ControlButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function ControlButton({
  children,
  onClick,
  label,
  active,
  className,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-full text-white/90 transition hover:bg-white/15 hover:text-white",
        active && "bg-white/15 text-white",
        className
      )}
    >
      {children}
    </button>
  );
}
