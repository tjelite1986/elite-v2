"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import ShortCard, { type FeedShort } from "@/components/short-card";

export default function ShortsFeed({
  channel,
  focusId,
  profileId,
  playlistId,
  category,
  isAdmin = false,
  viewerId,
  basePath = "/shorts",
}: {
  channel: "main" | "18plus";
  focusId?: number;
  isAdmin?: boolean;
  // The current user's id, threaded to each card for the owner visibility toggle.
  viewerId: number;
  // Section base path, so the 18+ section's empty-state link stays in /shorts18.
  basePath?: string;
  // When set, the feed is scoped to a single auto-poll profile and the global
  // upload/admin action buttons are hidden.
  profileId?: number;
  // When set, the feed is scoped to a playlist.
  playlistId?: number;
  // When set, the channel feed is filtered to a single 18+ category.
  category?: string;
}) {
  const [items, setItems] = useState<FeedShort[]>([]);
  // Opening from a grid tile: start the feed at that clip (older ones follow).
  const [cursor, setCursor] = useState<number | null>(focusId ? focusId + 1 : null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  // Backward pagination: clips NEWER than the top of the list, so a feed opened
  // mid-list from a grid tile can scroll up past its starting clip.
  const [prevCursor, setPrevCursor] = useState<number | null>(focusId ?? null);
  const [hasPrev, setHasPrev] = useState(Boolean(focusId));
  const [loadingPrev, setLoadingPrev] = useState(false);
  // Whether the initial jump to the focused clip has happened. Backward loading
  // is held until then so the jump and the prepend scroll compensation can't
  // race each other (state, not a ref: the top sentinel re-arms on re-render).
  const [focusJumped, setFocusJumped] = useState(!focusId);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [muted, setMuted] = useState(true);
  // Clean view: hide all overlay UI (rail, caption, progress) for a distraction-
  // free fullscreen feel. Persisted, and toggled back by long-pressing a clip.
  const [chromeHidden, setChromeHidden] = useState(false);
  const [hint, setHint] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setChromeHidden(localStorage.getItem("shorts:chromeHidden") === "1");
  }, []);

  // In the clean view, flag the body so the global nav chrome (top menu bar,
  // Shorts/18+ tabs, category chips) hides too — a true fullscreen, not just a
  // bare clip. Cleared on exit and when leaving the feed.
  useEffect(() => {
    document.body.classList.toggle("shorts-immersive", chromeHidden);
    return () => document.body.classList.remove("shorts-immersive");
  }, [chromeHidden]);

  const toggleChrome = useCallback(() => {
    setChromeHidden((prev) => {
      const next = !prev;
      localStorage.setItem("shorts:chromeHidden", next ? "1" : "0");
      if (next) {
        setHint(true);
        setTimeout(() => setHint(false), 2500);
        // Go true device-fullscreen too (hides the browser's address/system
        // bars). Needs the tap as a user gesture; best-effort + unsupported on
        // iOS for non-video elements, where the CSS immersive view still applies.
        document.documentElement.requestFullscreen?.().catch(() => {});
      } else if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
      return next;
    });
  }, []);

  // If the user leaves fullscreen via the system (back gesture / Esc), restore
  // the chrome so the state stays in sync.
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) {
        setChromeHidden((prev) => {
          if (!prev) return prev;
          localStorage.setItem("shorts:chromeHidden", "0");
          return false;
        });
      }
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // Leave fullscreen if the feed unmounts (e.g. navigating away) while active.
  useEffect(() => {
    return () => {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, []);

  const load = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const url = new URL("/api/shorts/feed", window.location.origin);
      url.searchParams.set("channel", channel);
      if (profileId) url.searchParams.set("profile", String(profileId));
      if (playlistId) url.searchParams.set("playlist", String(playlistId));
      if (category) url.searchParams.set("category", category);
      if (cursor) url.searchParams.set("cursor", String(cursor));
      const res = await fetch(url.toString());
      if (res.ok) {
        const data = await res.json();
        setItems((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          const fresh = (data.items as FeedShort[]).filter((i) => !seen.has(i.id));
          return [...prev, ...fresh];
        });
        setCursor(data.nextCursor);
        setHasMore(data.nextCursor !== null);
      }
    } finally {
      setLoading(false);
    }
  }, [channel, cursor, hasMore, loading, profileId, playlistId, category]);

  // Backward load: clips immediately newer than the current top, prepended.
  // Held until the initial focus jump is done; the prepend is committed
  // synchronously (flushSync) and the scroll compensated right after, so no
  // other effect can scroll in between.
  const loadPrev = useCallback(async () => {
    if (loadingPrev || !hasPrev || prevCursor === null || !focusJumped) return;
    setLoadingPrev(true);
    try {
      const url = new URL("/api/shorts/feed", window.location.origin);
      url.searchParams.set("channel", channel);
      if (profileId) url.searchParams.set("profile", String(profileId));
      if (playlistId) url.searchParams.set("playlist", String(playlistId));
      if (category) url.searchParams.set("category", category);
      url.searchParams.set("after", String(prevCursor));
      const res = await fetch(url.toString());
      if (res.ok) {
        const data = await res.json();
        const root = containerRef.current;
        // Anchor the current topmost clip, commit the prepend synchronously,
        // then shift the scroll by exactly how far that clip moved. Offsets are
        // multiples of the card height, so scroll-snap stays on a boundary.
        const first = root?.querySelector<HTMLElement>("[data-short-id]");
        const anchor =
          first && root
            ? {
                id: Number(first.dataset.shortId),
                // Visual offset of the anchor clip within the viewport.
                delta: first.offsetTop - root.scrollTop,
              }
            : null;
        flushSync(() => {
          setItems((prev) => {
            const seen = new Set(prev.map((p) => p.id));
            const fresh = (data.items as FeedShort[]).filter(
              (i) => !seen.has(i.id)
            );
            return fresh.length ? [...fresh, ...prev] : prev;
          });
          setPrevCursor(data.nextCursor);
          setHasPrev(data.nextCursor !== null);
        });
        if (anchor && root) {
          const el = root.querySelector<HTMLElement>(
            `[data-short-id="${anchor.id}"]`
          );
          // Set the position ABSOLUTELY (same visual offset for the anchor
          // clip), not relatively: on snap containers the browser itself may
          // already have followed the snapped clip when items were prepended
          // (scroll-snap re-snap), and a relative shift would double up.
          if (el) root.scrollTop = el.offsetTop - anchor.delta;
        }
      }
    } finally {
      setLoadingPrev(false);
    }
  }, [
    channel,
    prevCursor,
    hasPrev,
    loadingPrev,
    focusJumped,
    profileId,
    playlistId,
    category,
  ]);

  // Initial load.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Infinite scroll via a sentinel near the end of the list.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) load();
      },
      { root: containerRef.current, rootMargin: "600px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [load]);

  // Backward infinite scroll via a sentinel at the top of the list.
  useEffect(() => {
    const el = topSentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadPrev();
      },
      { root: containerRef.current, rootMargin: "400px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadPrev]);

  // Track which card is in view (>=60% visible) to drive autoplay.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio >= 0.6) {
            const id = Number((e.target as HTMLElement).dataset.shortId);
            if (id) setActiveId(id);
          }
        }
      },
      { root, threshold: [0.6] }
    );
    const cards = root.querySelectorAll("[data-short-id]");
    cards.forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, [items]);

  // Jump to a shared clip once it's in the list (once only — backward loads
  // prepend items and this must not yank the view back to the starting clip).
  useEffect(() => {
    if (!focusId || focusJumped || !containerRef.current) return;
    const el = containerRef.current.querySelector(
      `[data-short-id="${focusId}"]`
    );
    if (el) {
      (el as HTMLElement).scrollIntoView();
      setFocusJumped(true);
    } else if (items.length > 0) {
      // The focused clip is gone (deleted): the first batch would have started
      // at it. Mark the jump done so backward loading isn't held forever.
      setFocusJumped(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, focusId, focusJumped]);

  return (
    <div
      ref={containerRef}
      className={
        // overscroll-y-contain: swiping past the top must not chain to the
        // browser's pull-to-refresh (it reloaded the page mid-feed on Android).
        // overflow-anchor:none: loadPrev compensates the scroll itself; the
        // browser's native scroll anchoring would double the shift on prepend.
        chromeHidden
          ? "fixed inset-0 z-30 w-full snap-y snap-mandatory overflow-y-scroll overscroll-y-contain [overflow-anchor:none] bg-black"
          : "relative h-[calc(100dvh-3.5rem)] w-full snap-y snap-mandatory overflow-y-scroll overscroll-y-contain [overflow-anchor:none] bg-black"
      }
    >
      <div ref={topSentinelRef} className="h-px w-full" />
      {items.map((short) => (
        <div key={short.id} data-short-id={short.id} className="h-full w-full">
          <ShortCard
            short={short}
            active={activeId === short.id}
            muted={muted}
            onToggleMuted={() => setMuted((m) => !m)}
            viewerId={viewerId}
            categoryEditable={isAdmin && channel === "18plus"}
            isAdmin={isAdmin}
            chromeHidden={chromeHidden}
            onToggleChrome={toggleChrome}
            onRemoved={(id) => setItems((prev) => prev.filter((s) => s.id !== id))}
          />
        </div>
      ))}

      <div ref={sentinelRef} className="h-1 w-full" />

      {hint && (
        <div className="pointer-events-none fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/75 px-4 py-2 text-sm font-medium text-white">
          Long-press a clip to show the controls again
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-white/60">
          <p>No clips yet.</p>
          <Link
            href={
              channel === "18plus"
                ? `${basePath}/upload?channel=18plus`
                : `${basePath}/upload`
            }
            className="rounded-full bg-rose-500 px-5 py-2 text-sm font-semibold text-white"
          >
            Upload the first one
          </Link>
        </div>
      )}

    </div>
  );
}
