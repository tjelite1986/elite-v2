"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

/**
 * A clip that plays where it stands, used by the shorts grid at one per row.
 *
 * Autoplay rules that browsers actually enforce: a clip may only start on its
 * own while muted, so it starts muted and the viewer unmutes. Only one clip
 * plays at a time — a scrolling list of simultaneously playing videos is both
 * unusable and a bandwidth fire — which is what the module-level `playing`
 * holds: the pause is issued by whichever clip takes over, so it works across
 * every grid mounted on the page.
 */
let playing: HTMLVideoElement | null = null;

export default function ShortsInlineClip({
  id,
  poster,
  muted,
  onMuteChange,
}: {
  id: number;
  poster: string | null;
  // Shared across the list: unmuting one clip keeps the next one audible.
  muted: boolean;
  onMuteChange: (muted: boolean) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  // Whether this clip is the one in view. Drives both the playback and the
  // "playing" affordance, so the two can never disagree.
  const [active, setActive] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        // Most of the clip has to be on screen: a sliver at the edge of the
        // viewport is not what the viewer is looking at.
        const inView = entry.intersectionRatio >= 0.6;
        setActive(inView);
        if (inView) {
          if (playing && playing !== el) playing.pause();
          playing = el;
          // Rejects when autoplay is blocked or the codec is missing; the
          // poster stays up, which is the right fallback either way.
          void el.play().catch(() => {});
        } else {
          el.pause();
          if (playing === el) playing = null;
        }
      },
      { threshold: [0, 0.6, 1] }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (playing === el) playing = null;
    };
  }, []);

  return (
    <>
      <video
        ref={ref}
        data-inline-clip={id}
        data-active={active ? "1" : "0"}
        src={`/api/shorts/${id}/video`}
        poster={poster ?? undefined}
        className="h-full w-full object-cover"
        muted={muted}
        loop
        playsInline
        // Nothing is fetched until this clip is the one in view.
        preload="none"
      />
      <button
        onClick={(e) => {
          // The tile is a link into the immersive feed; muting is not a tap
          // on the clip.
          e.preventDefault();
          e.stopPropagation();
          onMuteChange(!muted);
        }}
        aria-label={muted ? "Unmute" : "Mute"}
        className="absolute bottom-2 right-2 rounded-full bg-black/60 p-2 text-white transition active:scale-90"
      >
        {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
      </button>
    </>
  );
}
