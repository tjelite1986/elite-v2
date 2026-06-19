"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import ShortCard, { type FeedShort } from "@/components/short-card";

export default function ShortsFeed({
  channel,
  focusId,
  profileId,
  playlistId,
  category,
  isAdmin = false,
  basePath = "/shorts",
}: {
  channel: "main" | "18plus";
  focusId?: number;
  isAdmin?: boolean;
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
  const [activeId, setActiveId] = useState<number | null>(null);
  const [muted, setMuted] = useState(true);

  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

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

  // Jump to a shared clip once it's in the list.
  useEffect(() => {
    if (!focusId || !containerRef.current) return;
    const el = containerRef.current.querySelector(
      `[data-short-id="${focusId}"]`
    );
    if (el) (el as HTMLElement).scrollIntoView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, focusId]);

  return (
    <div
      ref={containerRef}
      className="relative h-[calc(100dvh-3.5rem)] w-full snap-y snap-mandatory overflow-y-scroll bg-black"
    >
      {items.map((short) => (
        <div key={short.id} data-short-id={short.id} className="h-full w-full">
          <ShortCard
            short={short}
            active={activeId === short.id}
            muted={muted}
            onToggleMuted={() => setMuted((m) => !m)}
            categoryEditable={isAdmin && channel === "18plus"}
          />
        </div>
      ))}

      <div ref={sentinelRef} className="h-1 w-full" />

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
