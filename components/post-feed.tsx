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
  restoreKey,
}: {
  query: Record<string, string>;
  empty?: string;
  // Who is looking: enables the delete action on own posts (or all, for admins).
  viewer?: LightboxViewer;
  // When set, the loaded cards + scroll position are cached (sessionStorage) so
  // returning after leaving the lightbox lands where you left.
  restoreKey?: string;
}) {
  const [items, setItems] = useState<FeedPost[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<{ id: number; photo: number } | null>(null);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;
  const openRef = useRef(open);
  openRef.current = open;
  const openedAtRef = useRef<number | null>(null);

  const saveCache = useCallback(() => {
    if (!restoreKey) return;
    try {
      sessionStorage.setItem(
        "pf:" + restoreKey,
        JSON.stringify({
          items: itemsRef.current.slice(0, 400),
          cursor: cursorRef.current,
          hasMore: hasMoreRef.current,
          scrollY: window.scrollY,
          at: Date.now(),
        })
      );
    } catch {
      /* quota / private mode */
    }
  }, [restoreKey]);

  const openPost = useCallback(
    (id: number, photo: number) => {
      openedAtRef.current = id;
      saveCache();
      setOpen({ id, photo });
    },
    [saveCache]
  );

  const closeLightbox = useCallback(() => {
    const last = openRef.current?.id;
    const openedAt = openedAtRef.current;
    setOpen(null);
    if (last && last !== openedAt) {
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-post-id="${last}"]`)
          ?.scrollIntoView({ block: "center" });
      });
    }
  }, []);

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

  // Restore cached cards + scroll on mount, else initial load.
  useEffect(() => {
    if (restoreKey) {
      try {
        const raw = sessionStorage.getItem("pf:" + restoreKey);
        if (raw) {
          const c = JSON.parse(raw);
          if (c?.items?.length && Date.now() - (c.at || 0) < 5 * 60 * 1000) {
            setItems(c.items);
            setCursor(c.cursor ?? null);
            setHasMore(c.hasMore ?? true);
            setLoadedOnce(true);
            const targetY = c.scrollY || 0;
            let tries = 0;
            const apply = () => {
              window.scrollTo(0, targetY);
              if (Math.abs(window.scrollY - targetY) > 4 && ++tries < 40) {
                requestAnimationFrame(apply);
              }
            };
            requestAnimationFrame(apply);
            return;
          }
        }
      } catch {
        /* fall through */
      }
    }
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
    <div className="space-y-4">
      {items.map((p) => (
        <div key={p.id} data-post-id={p.id}>
          <PostCard
            post={p}
            onImageTap={(photo) => openPost(p.id, photo)}
            onPatch={(patch) =>
              setItems((prev) =>
                prev.map((x) => (x.id === p.id ? { ...x, ...patch } : x))
              )
            }
          />
        </div>
      ))}
      <div ref={sentinel} className="h-1 w-full" />
      {loading && <p className="py-4 text-center text-sm text-white/40">Loading…</p>}

      <PostLightbox
        posts={items}
        open={open}
        viewer={viewer}
        onClose={closeLightbox}
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
