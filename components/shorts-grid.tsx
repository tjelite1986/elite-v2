"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Play, Heart } from "lucide-react";
import { SHORT_CATEGORIES, CATEGORY_LABELS } from "@/lib/shorts-categories";

interface GridShort {
  id: number;
  caption: string | null;
  has_poster: boolean;
  like_count: number;
  profile_name: string | null;
  category: string;
}

// Responsive poster-thumbnail grid used by Explore, profile pages and playlists.
// Tapping a tile opens the immersive feed starting at that clip — its href is
// `${hrefPrefix}${id}` (a STRING, not a function: server components can't pass
// function props to a client component). `query` is the /api/shorts/feed scope.
export default function ShortsGrid({
  query,
  hrefPrefix,
  empty = "No clips yet.",
  categoryEditable = false,
}: {
  query: Record<string, string>;
  hrefPrefix: string;
  empty?: string;
  // Admins in the 18+ section get a per-tile category selector to sort clips.
  categoryEditable?: boolean;
}) {
  const [items, setItems] = useState<GridShort[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const url = new URL("/api/shorts/feed", window.location.origin);
      url.searchParams.set("limit", "30");
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
      if (cursor) url.searchParams.set("cursor", String(cursor));
      const res = await fetch(url.toString());
      if (res.ok) {
        const data = await res.json();
        setItems((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...(data.items as GridShort[]).filter((i) => !seen.has(i.id))];
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

  const setCategory = async (id: number, category: string) => {
    // Optimistic: reflect the new bucket immediately, revert on failure.
    const prev = items;
    setItems((list) =>
      list.map((s) => (s.id === id ? { ...s, category } : s))
    );
    const res = await fetch(`/api/shorts/${id}/category`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category }),
    });
    if (!res.ok) setItems(prev);
  };

  if (loadedOnce && items.length === 0) {
    return <p className="px-4 py-16 text-center text-sm text-white/50">{empty}</p>;
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-5">
        {items.map((s) => (
          <div
            key={s.id}
            className="group relative aspect-[9/16] overflow-hidden rounded-md bg-white/5"
          >
            <Link href={`${hrefPrefix}${s.id}`} className="block h-full w-full">
              {s.has_poster ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/shorts/${s.id}/poster`}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover transition group-hover:opacity-80"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-white/30">
                  <Play size={28} />
                </div>
              )}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1 text-[11px] text-white">
                <Heart size={12} className="fill-white/90" />
                {s.like_count}
              </div>
            </Link>
            {categoryEditable && (
              <select
                value={(SHORT_CATEGORIES as string[]).includes(s.category) ? s.category : "uncategorized"}
                onChange={(e) => setCategory(s.id, e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="absolute left-1 top-1 max-w-[85%] rounded bg-black/70 px-1 py-0.5 text-[10px] text-white ring-1 ring-white/20 focus:outline-none"
                title="Set category"
              >
                {SHORT_CATEGORIES.map((c) => (
                  <option key={c} value={c} className="bg-neutral-800">
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            )}
          </div>
        ))}
      </div>
      <div ref={sentinel} className="h-1 w-full" />
      {loading && (
        <p className="py-4 text-center text-sm text-white/40">Loading…</p>
      )}
    </>
  );
}
