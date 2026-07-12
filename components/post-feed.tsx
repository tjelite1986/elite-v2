"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PostCard from "@/components/post-card";
import PostLightbox, { LightboxViewer } from "@/components/post-lightbox";
import type { FeedPost } from "@/lib/posts";

// Vertical post feed (home or any scope). Cursor-paginated from /api/posts/feed
// with infinite scroll, mirroring the shorts grid loader. Tapping a photo opens
// the shared PostLightbox with like/comment/delete and feed stepping.
export default function PostFeed({
  query,
  empty = "No posts yet.",
  viewer,
}: {
  query: Record<string, string>;
  empty?: string;
  // Who is looking: enables the delete action on own posts (or all, for admins).
  viewer?: LightboxViewer;
}) {
  const [items, setItems] = useState<FeedPost[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<{ id: number; photo: number } | null>(null);

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
        <PostCard
          key={p.id}
          post={p}
          onImageTap={(photo) => setOpen({ id: p.id, photo })}
          onPatch={(patch) =>
            setItems((prev) =>
              prev.map((x) => (x.id === p.id ? { ...x, ...patch } : x))
            )
          }
        />
      ))}
      <div ref={sentinel} className="h-1 w-full" />
      {loading && <p className="py-4 text-center text-sm text-white/40">Loading…</p>}

      <PostLightbox
        posts={items}
        open={open}
        viewer={viewer}
        onClose={() => setOpen(null)}
        onNavigate={(id) => setOpen({ id, photo: 0 })}
        onNearEnd={load}
        onPatch={(id, patch) =>
          setItems((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
        }
        onRemove={(id) => setItems((prev) => prev.filter((p) => p.id !== id))}
      />
    </div>
  );
}
