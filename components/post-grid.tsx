"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Heart,
  MessageCircle,
  Copy,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useBackDismiss } from "@/lib/use-back-dismiss";
import { CommentsSheet } from "@/components/post-card";
import type { FeedPost } from "@/lib/posts";

// Square-thumbnail grid (Explore, profile pages, hashtags). Tapping a tile opens
// the photo in a lightbox at full display resolution with like/comment/delete
// actions; swiping or scrolling vertically steps through the feed (and keeps
// paginating), so browsing continues without leaving the lightbox.
export default function PostGrid({
  query,
  empty = "No posts yet.",
  onSelect,
  select,
  reloadKey = 0,
  viewer,
}: {
  query: Record<string, string>;
  empty?: string;
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
  viewer?: { userId: number; isAdmin: boolean };
}) {
  const [items, setItems] = useState<FeedPost[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  // Lightbox: id of the open post (resolved against items so like/comment/delete
  // updates flow straight from the shared list) and which of its photos shows.
  const [openId, setOpenId] = useState<number | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const open = openId !== null ? items.find((p) => p.id === openId) ?? null : null;
  // Register the comments sheet BEFORE the lightbox: cleanup runs in declaration
  // order, and only a stack-top entry pops its history sentinel — sheet first
  // keeps both entries popped when the lightbox closes with the sheet open.
  useBackDismiss(commentsOpen, () => setCommentsOpen(false));
  useBackDismiss(openId !== null, () => {
    setOpenId(null);
    setCommentsOpen(false);
  });

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
  useEffect(() => {
    let cancelled = false;
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

  // --- lightbox actions ---

  const canDelete = (p: FeedPost) =>
    !!viewer && (viewer.isAdmin || (p.author.type === "user" && p.author.id === viewer.userId));

  const toggleLike = useCallback(async (post: FeedPost) => {
    const next = !post.viewer_liked;
    const apply = (liked: boolean, count: number) =>
      setItems((prev) =>
        prev.map((p) => (p.id === post.id ? { ...p, viewer_liked: liked, like_count: count } : p))
      );
    apply(next, post.like_count + (next ? 1 : -1));
    try {
      const res = await fetch(`/api/posts/${post.id}/like`, { method: "POST" });
      if (res.ok) {
        const d = await res.json();
        apply(d.liked, d.like_count);
      }
    } catch {
      /* keep optimistic */
    }
  }, []);

  const deletePost = useCallback(
    async (post: FeedPost) => {
      if (!window.confirm("Delete this post? The images will be removed.")) return;
      const res = await fetch(`/api/posts/${post.id}`, { method: "DELETE" });
      if (!res.ok) return;
      const idx = items.findIndex((p) => p.id === post.id);
      const next = items.filter((p) => p.id !== post.id);
      setItems(next);
      setPhotoIndex(0);
      setCommentsOpen(false);
      if (next.length === 0) setOpenId(null);
      else setOpenId(next[Math.min(Math.max(idx, 0), next.length - 1)].id);
    },
    [items]
  );

  // Step between photos inside the open post (chevrons, arrow keys, h-swipe).
  const stepPhoto = useCallback(
    (dir: number) => {
      const post = items.find((p) => p.id === openId);
      if (!post || post.media.length < 2) return;
      setPhotoIndex((cur) => (cur + dir + post.media.length) % post.media.length);
    },
    [items, openId]
  );

  // Step to the previous/next post in the feed (wheel, v-swipe, arrow keys) —
  // this is what lets browsing continue while the lightbox stays open.
  const stepPost = useCallback(
    (dir: number) => {
      const idx = items.findIndex((p) => p.id === openId);
      if (idx === -1) return;
      const next = idx + dir;
      if (next < 0 || next >= items.length) return;
      setPhotoIndex(0);
      setCommentsOpen(false);
      setOpenId(items[next].id);
    },
    [items, openId]
  );

  // Keep the feed paginating while stepping near the end inside the lightbox.
  useEffect(() => {
    if (openId === null) return;
    const idx = items.findIndex((p) => p.id === openId);
    if (idx !== -1 && idx >= items.length - 4) load();
  }, [openId, items, load]);

  // Lock the page scroll behind the lightbox while it is open.
  const lightboxOpen = openId !== null;
  useEffect(() => {
    if (!lightboxOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [lightboxOpen]);

  useEffect(() => {
    if (openId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (commentsOpen) setCommentsOpen(false);
        else setOpenId(null);
      } else if (e.key === "ArrowLeft") stepPhoto(-1);
      else if (e.key === "ArrowRight") stepPhoto(1);
      else if (e.key === "ArrowUp") stepPost(-1);
      else if (e.key === "ArrowDown") stepPost(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId, commentsOpen, stepPhoto, stepPost]);

  // Wheel = step posts (debounced: one gesture fires many wheel events).
  const wheelAt = useRef(0);
  const onWheel = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaY) < 20) return;
    const now = Date.now();
    if (now - wheelAt.current < 350) return;
    wheelAt.current = now;
    stepPost(e.deltaY > 0 ? 1 : -1);
  };

  // Touch: vertical swipe steps posts, horizontal swipe steps photos.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touchStart.current;
    touchStart.current = null;
    if (!s) return;
    const dx = e.changedTouches[0].clientX - s.x;
    const dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx) * 1.5) {
      stepPost(dy < 0 ? 1 : -1);
    } else if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      stepPhoto(dx < 0 ? 1 : -1);
    }
  };

  if (loadedOnce && items.length === 0) {
    return <p className="px-4 py-16 text-center text-sm text-white/50">{empty}</p>;
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-1">
        {items.map((p) => {
          const inner = (
            <>
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
            </>
          );
          const cls = "group relative aspect-square overflow-hidden bg-white/5";
          if (select?.active) {
            const checked = select.selected.has(p.id);
            return (
              <button
                key={p.id}
                onClick={() => select.toggle(p.id)}
                className={cn(cls, checked && "ring-2 ring-inset ring-white")}
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
              onClick={() => p.media[0] && onSelect(p.media[0].id)}
              className={cls}
            >
              {inner}
            </button>
          ) : (
            <button
              key={p.id}
              onClick={() => {
                setPhotoIndex(0);
                setOpenId(p.id);
              }}
              className={cls}
            >
              {inner}
            </button>
          );
        })}
      </div>
      <div ref={sentinel} className="h-1 w-full" />
      {loading && <p className="py-4 text-center text-sm text-white/40">Loading…</p>}

      {/* Lightbox: full display-resolution photo (not the grid thumbnail). */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black"
          onClick={() => setOpenId(null)}
          onWheel={onWheel}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {open.media[photoIndex] && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/posts/media/${open.media[photoIndex].id}`}
              alt=""
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={() => !open.viewer_liked && toggleLike(open)}
              className="max-h-full max-w-full object-contain"
            />
          )}
          <button
            onClick={() => {
              setOpenId(null);
              setCommentsOpen(false);
            }}
            aria-label="Close"
            className="absolute right-3 top-3 rounded-full bg-black/60 p-2 text-white transition hover:bg-black/80"
          >
            <X size={20} />
          </button>
          <Link
            href={`/posts/p/${open.id}`}
            onClick={(e) => e.stopPropagation()}
            className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-2 text-xs font-semibold text-white transition hover:bg-black/80"
          >
            <ExternalLink size={14} /> Open post
          </Link>
          {open.media.length > 1 && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  stepPhoto(-1);
                }}
                aria-label="Previous photo"
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white transition hover:bg-black/80"
              >
                <ChevronLeft size={22} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  stepPhoto(1);
                }}
                aria-label="Next photo"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white transition hover:bg-black/80"
              >
                <ChevronRight size={22} />
              </button>
            </>
          )}

          {/* Action bar: like / comment (and delete when allowed). */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-4 pb-4 pt-12"
          >
            {open.media.length > 1 && (
              <div className="mb-3 flex justify-center gap-1.5">
                {open.media.map((m, i) => (
                  <span
                    key={m.id}
                    className={cn(
                      "size-1.5 rounded-full",
                      i === photoIndex ? "bg-white" : "bg-white/40"
                    )}
                  />
                ))}
              </div>
            )}
            <div className="flex items-center gap-5">
              <button
                onClick={() => toggleLike(open)}
                className="flex items-center gap-1.5 text-white transition active:scale-90"
                aria-label="Like"
              >
                <Heart
                  size={24}
                  className={cn(open.viewer_liked && "fill-rose-500 text-rose-500")}
                />
                {open.like_count > 0 && (
                  <span className="text-sm font-semibold">{open.like_count}</span>
                )}
              </button>
              <button
                onClick={() => setCommentsOpen(true)}
                className="flex items-center gap-1.5 text-white transition active:scale-90"
                aria-label="Comments"
              >
                <MessageCircle size={23} />
                {open.comment_count > 0 && (
                  <span className="text-sm font-semibold">{open.comment_count}</span>
                )}
              </button>
              <div className="flex-1" />
              {canDelete(open) && (
                <button
                  onClick={() => deletePost(open)}
                  aria-label="Delete post"
                  className="text-rose-300 transition hover:text-rose-400 active:scale-90"
                >
                  <Trash2 size={22} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {open && commentsOpen && (
        <CommentsSheet
          postId={open.id}
          onClose={() => setCommentsOpen(false)}
          onCountChange={(n) =>
            setItems((prev) =>
              prev.map((p) => (p.id === open.id ? { ...p, comment_count: n } : p))
            )
          }
        />
      )}
    </>
  );
}
