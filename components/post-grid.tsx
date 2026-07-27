"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Heart, MessageCircle, Copy, Check, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import PostLightbox, { LightboxViewer } from "@/components/post-lightbox";
import type { FeedPost } from "@/lib/posts";

// Images per row, picked by the viewer. 3 is the classic square grid; 1 shows
// every post uncropped at its own aspect ratio (the square thumbnail is a CROP,
// so an uncropped tile has to ask the media route for ?size=fit instead).
type GridCols = 1 | 2 | 3;
const COL_ORDER: readonly GridCols[] = [3, 2, 1];
const COLS_KEY = "post-grid-cols";
const COL_CLASS: Record<GridCols, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
};

function parseCols(raw: string | null): GridCols | null {
  const n = Number(raw);
  return n === 1 || n === 2 || n === 3 ? n : null;
}

// A post is laid out uncropped when the grid is one-per-row, or when its first
// image is wider than tall — a landscape photo squeezed into a square tile
// loses its sides, so it takes a row of its own instead.
function isLandscapeMedia(p: FeedPost): boolean {
  const m = p.media[0];
  return Boolean(m?.width && m?.height && m.width > m.height);
}

// Square-thumbnail grid (Explore, profile pages, hashtags). Tapping a tile opens
// the shared PostLightbox: full display resolution with like/comment/delete and
// vertical stepping through the feed (paginating as it goes).
export default function PostGrid({
  query,
  empty = "No posts yet.",
  onSelect,
  select,
  reloadKey = 0,
  viewer,
  restoreKey,
}: {
  query: Record<string, string>;
  empty?: string;
  // When set, the loaded tiles + scroll position are cached (sessionStorage) so
  // returning here after navigating away from the lightbox (into a profile or a
  // post permalink) lands where you left. Must be unique per surface.
  restoreKey?: string;
  // Selection mode: when set, a tile calls onSelect(firstMediaId) instead of
  // linking to the post (used to pick a profile picture from the real feed).
  onSelect?: (mediaId: number) => void;
  // Post-selection mode (combine into stack): when active, a tile toggles the
  // post id in the selection set instead of navigating.
  select?: {
    active: boolean;
    selected: Set<number>;
    toggle: (postId: number) => void;
  };
  // Bump to force a fresh reload from the first page (e.g. after a merge).
  reloadKey?: number;
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
  // Density is a viewer preference, remembered across surfaces and visits.
  // Read post-mount (not in the initializer) so SSR and hydration agree.
  const [cols, setCols] = useState<GridCols>(3);
  useEffect(() => {
    try {
      const saved = parseCols(localStorage.getItem(COLS_KEY));
      if (saved) setCols(saved);
    } catch {
      /* private mode — stay on the default */
    }
  }, []);
  const switchCols = (c: GridCols) => {
    setCols(c);
    try {
      localStorage.setItem(COLS_KEY, String(c));
    } catch {
      /* preference just won't persist */
    }
  };

  // Latest state, for the click-time cache save.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;
  // Track the live open target (updated as you swipe) and the id the lightbox
  // was opened at, so closing can land the grid on the LAST-viewed post.
  const openRef = useRef(open);
  openRef.current = open;
  const openedAtRef = useRef<number | null>(null);

  // Cache tiles + scroll so returning after leaving the lightbox (into a profile
  // or permalink) restores the position. Saved when a post is OPENED — the grid
  // is a fixed overlay's backdrop then, so window.scrollY is still the grid's
  // offset; by the time any in-lightbox link navigates, Next has scrolled to 0.
  const saveCache = useCallback(() => {
    if (!restoreKey) return;
    try {
      sessionStorage.setItem(
        "pg:" + restoreKey,
        JSON.stringify({
          items: itemsRef.current.slice(0, 800),
          cursor: cursorRef.current,
          hasMore: hasMoreRef.current,
          scrollY: window.scrollY,
          at: Date.now(),
        })
      );
    } catch {
      /* quota / private mode — position just won't restore */
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

  // Closing lands the grid on the last-viewed post when you swiped away from the
  // one you opened (the overlay never moved the grid). Same-post open/close
  // leaves the scroll untouched.
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

  // Initial load, and a full reset+reload whenever reloadKey changes (so a merge
  // immediately drops the emptied source posts and shows the new carousel).
  const firstRun = useRef(true);
  useEffect(() => {
    let cancelled = false;

    // On the very first mount (not a reloadKey reset), restore the cached tiles
    // + scroll instead of fetching from the top. Short-lived (5 min) so a later
    // fresh visit doesn't land mid-list.
    if (firstRun.current && restoreKey) {
      firstRun.current = false;
      try {
        const raw = sessionStorage.getItem("pg:" + restoreKey);
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
            return; // skip the initial fetch
          }
        }
      } catch {
        /* fall through to a normal load */
      }
    }
    firstRun.current = false;

    setItems([]);
    setCursor(null);
    setHasMore(true);
    setLoadedOnce(false);
    setLoading(true);
    (async () => {
      try {
        const url = new URL("/api/posts/feed", window.location.origin);
        url.searchParams.set("limit", "24");
        for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
        const res = await fetch(url.toString());
        if (res.ok && !cancelled) {
          const data = await res.json();
          setItems(data.items as FeedPost[]);
          setCursor(data.nextCursor);
          setHasMore(data.nextCursor !== null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setLoadedOnce(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

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
      <div className="mb-2 flex justify-end gap-1 px-1">
        {COL_ORDER.map((c) => (
          <button
            key={c}
            onClick={() => switchCols(c)}
            aria-label={`${c} per row`}
            aria-pressed={c === cols}
            className={
              c === cols
                ? "rounded-full bg-white px-3 py-1 text-xs font-semibold text-black"
                : "rounded-full bg-white/10 px-3 py-1 text-xs text-white/70 transition hover:bg-white/15"
            }
          >
            {c}
          </button>
        ))}
      </div>
      <div className={cn("grid gap-1", COL_CLASS[cols])}>
        {items.map((p) => {
          // One-per-row shows everything uncropped; in the denser grids only a
          // landscape post breaks out, taking a full row of its own.
          const uncropped = cols === 1 || isLandscapeMedia(p);
          const m = p.media[0];
          const ratio =
            uncropped && m?.width && m?.height ? `${m.width} / ${m.height}` : undefined;
          const inner = (
            <>
              {p.media[0] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/posts/media/${p.media[0].id}?size=${uncropped ? "fit" : "thumb"}`}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover transition group-hover:opacity-80"
                />
              )}
              {p.media.length > 1 ? (
                <Copy size={15} className="absolute right-1.5 top-1.5 text-white drop-shadow" />
              ) : p.media[0]?.is_video ? (
                <Play size={15} className="absolute right-1.5 top-1.5 fill-white text-white drop-shadow" />
              ) : null}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-4 bg-black/40 text-sm font-semibold text-white opacity-0 transition group-hover:opacity-100">
                <span className="flex items-center gap-1">
                  <Heart size={16} className="fill-white" /> {p.like_count}
                </span>
                <span className="flex items-center gap-1">
                  <MessageCircle size={16} className="fill-white" /> {p.comment_count}
                </span>
              </div>
            </>
          );
          const cls = cn(
            "group relative overflow-hidden bg-white/5",
            // A landscape post in a multi-column grid takes the whole row, so no
            // row ever mixes a wide tile with a tall one.
            uncropped ? "col-span-full" : "aspect-square",
            // Falls back to square when the dimensions were never recorded.
            uncropped && !ratio && "aspect-square"
          );
          // The tile takes the image's own ratio, so ?size=fit fills it exactly.
          const tileStyle = ratio ? { aspectRatio: ratio } : undefined;
          if (select?.active) {
            const checked = select.selected.has(p.id);
            return (
              <button
                key={p.id}
                onClick={() => select.toggle(p.id)}
                className={cn(cls, checked && "ring-2 ring-inset ring-white")}
                style={tileStyle}
              >
                {inner}
                <span
                  className={cn(
                    "absolute left-1.5 top-1.5 flex size-5 items-center justify-center rounded-full border-2 transition",
                    checked
                      ? "border-white bg-white text-black"
                      : "border-white/80 bg-black/30"
                  )}
                >
                  {checked && <Check size={12} strokeWidth={3} />}
                </span>
              </button>
            );
          }
          return onSelect ? (
            <button
              key={p.id}
              data-post-id={p.id}
              onClick={() => p.media[0] && onSelect(p.media[0].id)}
              className={cls}
              style={tileStyle}
            >
              {inner}
            </button>
          ) : (
            <button
              key={p.id}
              data-post-id={p.id}
              onClick={() => openPost(p.id, 0)}
              className={cls}
              style={tileStyle}
            >
              {inner}
            </button>
          );
        })}
      </div>
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
    </>
  );
}
