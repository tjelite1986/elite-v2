"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Eye,
  EyeOff,
  Maximize,
  Minimize,
  ChevronsDown,
  ChevronsUp,
} from "lucide-react";
import VideoPostCard from "@/components/video-post-card";
import type { FeedPost } from "@/lib/posts";

// One feed entry per video media item — a carousel post with several videos
// becomes several consecutive cards sharing the post's like/comment state.
interface VideoEntry {
  key: string;
  post: FeedPost;
  mediaIndex: number;
}

function toEntries(posts: FeedPost[]): VideoEntry[] {
  const out: VideoEntry[] = [];
  for (const p of posts) {
    p.media.forEach((m, i) => {
      if (m.is_video) out.push({ key: `${p.id}-${m.id}`, post: p, mediaIndex: i });
    });
  }
  return out;
}

// The Videos tab feed: the same immersive vertical snap view as the Shorts
// feed (fullscreen cards, autoplay-in-view, overlay toggle, fullscreen), but
// over video posts via /api/posts/feed?videos=1.
export default function VideosFeed({
  viewer,
  restoreKey,
}: {
  viewer: { userId: number; isAdmin: boolean };
  // When set, the loaded posts + scroll position are cached (sessionStorage) so
  // returning after visiting a video's profile lands on the same clip instead of
  // the top.
  restoreKey?: string;
}) {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const postsRef = useRef(posts);
  postsRef.current = posts;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;
  const [muted, setMuted] = useState(true);
  const [chromeHidden, setChromeHidden] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [hint, setHint] = useState(false);
  // The view-control cluster is collapsed to a single chevron by default.
  const [controlsOpen, setControlsOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setChromeHidden(localStorage.getItem("shorts:chromeHidden") === "1");
  }, []);

  // Same immersive body flag as the shorts feed, so the global nav chrome and
  // the posts tab bar hide in fullscreen.
  useEffect(() => {
    document.body.classList.toggle("shorts-immersive", fullscreen);
    return () => document.body.classList.remove("shorts-immersive");
  }, [fullscreen]);

  const toggleChrome = useCallback(() => {
    setChromeHidden((prev) => {
      const next = !prev;
      localStorage.setItem("shorts:chromeHidden", next ? "1" : "0");
      if (next) {
        setHint(true);
        setTimeout(() => setHint(false), 2500);
      }
      return next;
    });
  }, []);

  const toggleFullscreen = useCallback(() => {
    setFullscreen((prev) => {
      const next = !prev;
      if (next) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      } else if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) setFullscreen(false);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  useEffect(() => {
    return () => {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, []);

  const load = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const url = new URL("/api/posts/feed", window.location.origin);
      url.searchParams.set("scope", "explore");
      url.searchParams.set("videos", "1");
      url.searchParams.set("limit", "12");
      if (cursor) url.searchParams.set("cursor", String(cursor));
      const res = await fetch(url.toString());
      if (res.ok) {
        const data = await res.json();
        setPosts((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...(data.items as FeedPost[]).filter((i) => !seen.has(i.id))];
        });
        setCursor(data.nextCursor);
        setHasMore(data.nextCursor !== null);
      }
    } finally {
      setLoading(false);
    }
  }, [cursor, hasMore, loading]);

  // Restore cached posts + scroll on mount, else initial load.
  useEffect(() => {
    if (restoreKey) {
      try {
        const raw = sessionStorage.getItem("vf:" + restoreKey);
        if (raw) {
          const c = JSON.parse(raw);
          if (c?.posts?.length && Date.now() - (c.at || 0) < 5 * 60 * 1000) {
            setPosts(c.posts);
            setCursor(c.cursor ?? null);
            setHasMore(c.hasMore ?? true);
            const top = c.scrollTop || 0;
            let tries = 0;
            const apply = () => {
              const root = containerRef.current;
              if (root) root.scrollTop = top;
              if (root && Math.abs(root.scrollTop - top) > 4 && ++tries < 40) {
                requestAnimationFrame(apply);
              }
            };
            requestAnimationFrame(apply);
            return;
          }
        }
      } catch {
        /* fall through to a normal load */
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist posts + container scroll each time the clip in view changes, so a
  // navigation away (into a profile) has an up-to-date position to return to.
  useEffect(() => {
    if (!restoreKey || !activeKey) return;
    try {
      sessionStorage.setItem(
        "vf:" + restoreKey,
        JSON.stringify({
          posts: postsRef.current.slice(0, 400),
          cursor: cursorRef.current,
          hasMore: hasMoreRef.current,
          scrollTop: containerRef.current?.scrollTop ?? 0,
          at: Date.now(),
        })
      );
    } catch {
      /* quota / private mode */
    }
  }, [activeKey, restoreKey]);

  const entries = toEntries(posts);

  // Infinite scroll via a sentinel near the end of the list.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (e) => e[0].isIntersecting && load(),
      { root: containerRef.current, rootMargin: "600px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [load]);

  // Track which card is in view (>=60% visible) to drive autoplay.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es) {
          if (e.isIntersecting && e.intersectionRatio >= 0.6) {
            const key = (e.target as HTMLElement).dataset.videoKey;
            if (key) setActiveKey(key);
          }
        }
      },
      { root, threshold: [0.6] }
    );
    root.querySelectorAll("[data-video-key]").forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, [entries.length]);

  const patchPost = useCallback((postId: number, patch: Partial<FeedPost>) => {
    setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, ...patch } : p)));
  }, []);

  const removePost = useCallback((postId: number) => {
    setPosts((prev) => prev.filter((p) => p.id !== postId));
  }, []);

  const removeMedia = useCallback((postId: number, mediaId: number) => {
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId ? { ...p, media: p.media.filter((m) => m.id !== mediaId) } : p
      )
    );
  }, []);

  const controlBtn =
    "rounded-full bg-black/50 p-2 text-white ring-1 ring-white/10 backdrop-blur transition hover:bg-black/70";

  return (
    <div
      className={
        fullscreen
          ? "fixed inset-0 z-30 bg-black"
          : // Stop above the global bottom bar so the caption overlay stays
            // visible — the same sizing as the shorts feed.
            "relative w-full bg-black h-[calc(100dvh-3.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))]"
      }
    >
      <div
        ref={containerRef}
        className="h-full w-full snap-y snap-mandatory overflow-y-scroll overscroll-y-contain [overflow-anchor:none]"
      >
        {entries.map((entry) => (
          <div key={entry.key} data-video-key={entry.key} className="h-full w-full">
            <VideoPostCard
              post={entry.post}
              media={entry.post.media[entry.mediaIndex]}
              active={activeKey === entry.key}
              muted={muted}
              onToggleMuted={() => setMuted((m) => !m)}
              viewer={viewer}
              chromeHidden={chromeHidden}
              onToggleChrome={toggleChrome}
              onToggleFullscreen={toggleFullscreen}
              onRemoved={removePost}
              onMediaRemoved={removeMedia}
              onPatch={patchPost}
            />
          </div>
        ))}

        <div ref={sentinelRef} className="h-1 w-full" />

        {!loading && entries.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-white/60">
            <p>No videos yet.</p>
            <Link
              href="/posts/create"
              className="rounded-full bg-rose-500 px-5 py-2 text-sm font-semibold text-white"
            >
              Share the first one
            </Link>
          </div>
        )}
      </div>

      {/* Collapsible view-control cluster ("^^"), same as the shorts feed. */}
      <div className="absolute right-2 top-2 z-40 flex flex-col items-end gap-1.5">
        <button
          onClick={() => setControlsOpen((v) => !v)}
          aria-label={controlsOpen ? "Collapse controls" : "Expand controls"}
          className={controlBtn}
        >
          {controlsOpen ? <ChevronsUp size={18} /> : <ChevronsDown size={18} />}
        </button>
        {controlsOpen && (
          <>
            <button
              onClick={toggleFullscreen}
              aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
              className={controlBtn}
            >
              {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>
            <button
              onClick={toggleChrome}
              aria-label={chromeHidden ? "Show overlay" : "Hide overlay"}
              className={controlBtn}
            >
              {chromeHidden ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </>
        )}
      </div>

      {hint && (
        <div className="pointer-events-none fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/75 px-4 py-2 text-sm font-medium text-white">
          Long-press a clip to show the controls again
        </div>
      )}
    </div>
  );
}
