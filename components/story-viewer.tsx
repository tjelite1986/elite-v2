"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import PostAvatar from "@/components/post-avatar";
import type { StoryGroup } from "@/lib/stories";

const STORY_MS = 5000;

// Full-screen story viewer: steps through the chosen author's stories then the
// next group, with top progress bars, tap-to-navigate, and auto-advance.
export default function StoryViewer({
  groups,
  startGroup,
  onClose,
}: {
  groups: StoryGroup[];
  startGroup: number;
  onClose: () => void;
}) {
  const [gi, setGi] = useState(startGroup);
  const [si, setSi] = useState(0);
  const [progress, setProgress] = useState(0);
  const raf = useRef<number | null>(null);
  const startedAt = useRef<number>(0);

  const group = groups[gi];
  const story = group?.stories[si];

  const next = useCallback(() => {
    setProgress(0);
    setSi((prevSi) => {
      const g = groups[gi];
      if (prevSi + 1 < g.stories.length) return prevSi + 1;
      // Move to the next group, or close at the end.
      if (gi + 1 < groups.length) {
        setGi(gi + 1);
        return 0;
      }
      onClose();
      return prevSi;
    });
  }, [gi, groups, onClose]);

  const prev = useCallback(() => {
    setProgress(0);
    setSi((prevSi) => {
      if (prevSi > 0) return prevSi - 1;
      if (gi > 0) {
        const pg = gi - 1;
        setGi(pg);
        return Math.max(0, groups[pg].stories.length - 1);
      }
      return 0;
    });
  }, [gi, groups]);

  // Mark the current story seen.
  useEffect(() => {
    if (!story) return;
    fetch(`/api/posts/stories/${story.id}/view`, { method: "POST" }).catch(() => {});
  }, [story]);

  // Drive the progress bar + auto-advance.
  useEffect(() => {
    if (!story) return;
    startedAt.current = performance.now();
    const tick = (t: number) => {
      const elapsed = t - startedAt.current;
      const p = Math.min(elapsed / STORY_MS, 1);
      setProgress(p);
      if (p >= 1) next();
      else raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [story, next]);

  // Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, onClose]);

  if (!group || !story) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black">
      <div className="relative h-full w-full max-w-md">
        {/* Progress bars */}
        <div className="absolute left-0 right-0 top-0 z-20 flex gap-1 p-2">
          {group.stories.map((s, i) => (
            <div key={s.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/30">
              <div
                className="h-full bg-white"
                style={{
                  width: i < si ? "100%" : i === si ? `${progress * 100}%` : "0%",
                }}
              />
            </div>
          ))}
        </div>

        {/* Header */}
        <div className="absolute left-0 right-0 top-3 z-20 flex items-center gap-2.5 px-3 pt-2 text-white">
          <PostAvatar username={group.username} size={32} />
          <span className="flex-1 text-sm font-semibold drop-shadow">@{group.username}</span>
          <button onClick={onClose} aria-label="Close" className="drop-shadow">
            <X size={24} />
          </button>
        </div>

        {/* Image */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/posts/stories/${story.id}/media`}
          alt=""
          className="h-full w-full object-contain"
        />

        {/* Tap zones */}
        <button
          onClick={prev}
          aria-label="Previous"
          className="absolute inset-y-0 left-0 z-10 w-1/3"
        />
        <button
          onClick={next}
          aria-label="Next"
          className="absolute inset-y-0 right-0 z-10 w-1/3"
        />
      </div>
    </div>
  );
}
