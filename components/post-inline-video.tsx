"use client";

import { useEffect, useRef } from "react";

/**
 * A post video that plays where it stands, used by the feed card.
 *
 * Autoplay rules that browsers actually enforce: a video may only start on its
 * own while muted, so it starts muted and the viewer unmutes through the native
 * controls. `muted` is set on the element rather than passed as a prop, or
 * React would put the mute back on the next render.
 *
 * Only one video plays at a time — a scrolling feed of simultaneously playing
 * videos is both unusable and a bandwidth fire — which is what the module-level
 * `playing` holds: the pause is issued by whichever video takes over, so it
 * works across every feed mounted on the page.
 */
let playing: HTMLVideoElement | null = null;

export default function PostInlineVideo({
  src,
  poster,
  className,
}: {
  src: string;
  poster?: string;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.muted = true;
    const io = new IntersectionObserver(
      ([entry]) => {
        // Most of the video has to be on screen: a sliver at the edge of the
        // viewport is not what the viewer is looking at.
        if (entry.intersectionRatio >= 0.6) {
          if (playing && playing !== el) playing.pause();
          playing = el;
          // Rejects when autoplay is blocked or the codec is missing; the
          // poster stays up and the controls still work, which is the right
          // fallback either way.
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
    <video
      ref={ref}
      src={src}
      poster={poster}
      controls
      loop
      playsInline
      // Nothing is fetched until this video is the one in view.
      preload="none"
      className={className}
    />
  );
}
