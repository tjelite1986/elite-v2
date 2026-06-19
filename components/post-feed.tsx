"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PostCard from "@/components/post-card";
import type { FeedPost } from "@/lib/posts";

// Vertical post feed (home or any scope). Cursor-paginated from /api/posts/feed
// with infinite scroll, mirroring the shorts grid loader.
export default function PostFeed({
  query,
  empty = "No posts yet.",
}: {
  query: Record<string, string>;
  empty?: string;
}) {
  const [items, setItems] = useState<FeedPost[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const url = new URL("/api/posts/feed", window.location.origin);
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
      if (cursor) url.searchParams.set("cursor", String(cursor));
      const res = await fetch(url.toString());
      if (res.ok) {
        const data = await res.json();
        setItems((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...(data.items as FeedPost[]).filter((i) => !seen.has(i.id))];
        });
        setCursor(data.nextCursor);
        setHasMore(data.nextCursor !== null);
      }
    } finally {
      setLoading(false);
      setLoadedOnce(true);
    }
  }, [cursor, hasMore, loading, query]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (e) => e[0].isIntersecting && load(),
      { rootMargin: "600px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [load]);

  if (loadedOnce && items.length === 0) {
    return <p className="px-4 py-16 text-center text-sm text-white/50">{empty}</p>;
  }

  return (
    <div className="space-y-3">
      {items.map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
      <div ref={sentinel} className="h-1 w-full" />
      {loading && <p className="py-4 text-center text-sm text-white/40">Loading…</p>}
    </div>
  );
}
