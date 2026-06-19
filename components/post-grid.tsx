"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Heart, MessageCircle, Copy } from "lucide-react";
import type { FeedPost } from "@/lib/posts";

// Square-thumbnail grid (Explore, profile pages, hashtags). Tapping a tile opens
// the post permalink. Cursor-paginated from /api/posts/feed.
export default function PostGrid({
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
      url.searchParams.set("limit", "24");
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
      { rootMargin: "800px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [load]);

  if (loadedOnce && items.length === 0) {
    return <p className="px-4 py-16 text-center text-sm text-white/50">{empty}</p>;
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-1">
        {items.map((p) => (
          <Link
            key={p.id}
            href={`/posts/p/${p.id}`}
            className="group relative aspect-square overflow-hidden bg-white/5"
          >
            {p.media[0] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/posts/media/${p.media[0].id}?size=thumb`}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover transition group-hover:opacity-80"
              />
            )}
            {p.media.length > 1 && (
              <Copy size={15} className="absolute right-1.5 top-1.5 text-white drop-shadow" />
            )}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-4 bg-black/40 text-sm font-semibold text-white opacity-0 transition group-hover:opacity-100">
              <span className="flex items-center gap-1">
                <Heart size={16} className="fill-white" /> {p.like_count}
              </span>
              <span className="flex items-center gap-1">
                <MessageCircle size={16} className="fill-white" /> {p.comment_count}
              </span>
            </div>
          </Link>
        ))}
      </div>
      <div ref={sentinel} className="h-1 w-full" />
      {loading && <p className="py-4 text-center text-sm text-white/40">Loading…</p>}
    </>
  );
}
