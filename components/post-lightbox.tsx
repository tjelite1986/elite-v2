"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Heart,
  MessageCircle,
  X,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Trash2,
  Clapperboard,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useBackDismiss } from "@/lib/use-back-dismiss";
import { CommentsSheet } from "@/components/post-card";
import PostAvatar from "@/components/post-avatar";
import Markdown from "@/components/markdown";
import type { FeedPost } from "@/lib/posts";

export interface LightboxViewer {
  userId: number;
  isAdmin: boolean;
}

// Fullscreen photo viewer shared by the grid (Explore/hashtags/profiles) and
// the vertical feed. Shows the tapped post at display resolution with
// like/comment/delete actions; vertical swipe, mouse wheel or arrow keys step
// through the surrounding list (parent keeps paginating via onNearEnd), and
// horizontal swipe or chevrons step through a carousel post's photos.
//
// Controlled: the parent owns which post is open and the list itself — the
// lightbox reports changes back through onNavigate/onPatch/onRemove so the
// underlying grid/feed stays in sync.
export default function PostLightbox({
  posts,
  open,
  viewer,
  onClose,
  onNavigate,
  onNearEnd,
  onPatch,
  onRemove,
}: {
  posts: FeedPost[];
  open: { id: number; photo: number } | null;
  viewer?: LightboxViewer;
  onClose: () => void;
  onNavigate: (id: number) => void;
  onNearEnd?: () => void;
  onPatch: (id: number, patch: Partial<FeedPost>) => void;
  onRemove?: (id: number) => void;
}) {
  const post = open ? posts.find((p) => p.id === open.id) ?? null : null;
  const [commentsOpen, setCommentsOpen] = useState(false);
  // Caption expansion, keyed to the post so stepping resets to clamped.
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Photo index, keyed to the open post so switching posts lands on the tapped
  // (or first) photo the same frame — no out-of-range flash from a reset effect.
  const [photoState, setPhotoState] = useState<{ id: number; idx: number }>({
    id: -1,
    idx: 0,
  });
  const photoIndex =
    open && photoState.id === open.id ? photoState.idx : open?.photo ?? 0;
  const setPhotoIndex = (idx: number) =>
    open && setPhotoState({ id: open.id, idx });

  const closeAll = useCallback(() => {
    setCommentsOpen(false);
    onClose();
  }, [onClose]);

  // Register the comments sheet BEFORE the lightbox: cleanup runs in declaration
  // order, and only a stack-top entry pops its history sentinel — sheet first
  // keeps both entries popped when the lightbox closes with the sheet open.
  useBackDismiss(commentsOpen, () => setCommentsOpen(false));
  useBackDismiss(open !== null, closeAll);

  const canDelete =
    !!post &&
    !!viewer &&
    !!onRemove &&
    (viewer.isAdmin ||
      (post.author.type === "user" && post.author.id === viewer.userId));
  // Same owner/admin rule for moving the current video to shorts.
  const canMoveToShorts = canDelete && !!post.media[photoIndex]?.is_video;

  const toggleLike = useCallback(
    async (p: FeedPost) => {
      const next = !p.viewer_liked;
      onPatch(p.id, {
        viewer_liked: next,
        like_count: p.like_count + (next ? 1 : -1),
      });
      try {
        const res = await fetch(`/api/posts/${p.id}/like`, { method: "POST" });
        if (res.ok) {
          const d = await res.json();
          onPatch(p.id, { viewer_liked: d.liked, like_count: d.like_count });
        }
      } catch {
        /* keep optimistic */
      }
    },
    [onPatch]
  );

  const deletePost = useCallback(
    async (p: FeedPost) => {
      if (!onRemove) return;
      if (!window.confirm("Delete this post? The images will be removed.")) return;
      const res = await fetch(`/api/posts/${p.id}`, { method: "DELETE" });
      if (!res.ok) return;
      const idx = posts.findIndex((x) => x.id === p.id);
      const next = posts[idx + 1] ?? posts[idx - 1];
      setCommentsOpen(false);
      onRemove(p.id);
      if (next) onNavigate(next.id);
      else onClose();
    },
    [posts, onRemove, onNavigate, onClose]
  );

  // Move the current video media to shorts (owner/admin). One tap, like the
  // shorts-side "To Videos" button. The post stays if it has other media left;
  // an emptied post is retired server-side and leaves the list here.
  const moveToShorts = useCallback(
    async (p: FeedPost, mediaIdx: number) => {
      const m = p.media[mediaIdx];
      if (!m?.is_video) return;
      const res = await fetch(`/api/posts/media/${m.id}/to-short`, { method: "POST" });
      if (!res.ok) return;
      const d = await res.json().catch(() => ({}));
      if (d.postDeleted && onRemove) {
        const idx = posts.findIndex((x) => x.id === p.id);
        const next = posts[idx + 1] ?? posts[idx - 1];
        setCommentsOpen(false);
        onRemove(p.id);
        if (next) onNavigate(next.id);
        else onClose();
      } else {
        onPatch(p.id, { media: p.media.filter((x) => x.id !== m.id) });
        setPhotoState({ id: p.id, idx: 0 });
      }
    },
    [posts, onRemove, onNavigate, onClose, onPatch]
  );

  // Step between photos inside the open post (chevrons, arrow keys, h-swipe).
  const stepPhoto = useCallback(
    (dir: number) => {
      if (!post || post.media.length < 2) return;
      setPhotoIndex((photoIndex + dir + post.media.length) % post.media.length);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [post, photoIndex]
  );

  // Step to the previous/next post in the list (wheel, v-swipe, arrow keys) —
  // this is what lets browsing continue while the lightbox stays open.
  const stepPost = useCallback(
    (dir: number) => {
      if (!open) return;
      const idx = posts.findIndex((p) => p.id === open.id);
      if (idx === -1) return;
      const next = idx + dir;
      if (next < 0 || next >= posts.length) return;
      setCommentsOpen(false);
      onNavigate(posts[next].id);
    },
    [posts, open, onNavigate]
  );

  // Keep the list paginating while stepping near the end inside the lightbox.
  useEffect(() => {
    if (!open || !onNearEnd) return;
    const idx = posts.findIndex((p) => p.id === open.id);
    if (idx !== -1 && idx >= posts.length - 4) onNearEnd();
  }, [open, posts, onNearEnd]);

  // Lock the page scroll behind the lightbox while it is open.
  const isOpen = open !== null;
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (commentsOpen) setCommentsOpen(false);
        else closeAll();
      } else if (e.key === "ArrowLeft") stepPhoto(-1);
      else if (e.key === "ArrowRight") stepPhoto(1);
      else if (e.key === "ArrowUp") stepPost(-1);
      else if (e.key === "ArrowDown") stepPost(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, commentsOpen, stepPhoto, stepPost, closeAll]);

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

  if (!post) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black"
        onClick={closeAll}
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {post.media[photoIndex] &&
          (post.media[photoIndex].is_video ? (
            <video
              key={post.media[photoIndex].id}
              src={`/api/posts/media/${post.media[photoIndex].id}`}
              poster={`/api/posts/media/${post.media[photoIndex].id}?size=thumb`}
              controls
              autoPlay
              playsInline
              onClick={(e) => e.stopPropagation()}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/posts/media/${post.media[photoIndex].id}`}
              alt=""
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={() => !post.viewer_liked && toggleLike(post)}
              className="max-h-full max-w-full object-contain"
            />
          ))}
        <button
          onClick={closeAll}
          aria-label="Close"
          className="absolute right-3 top-3 rounded-full bg-black/60 p-2 text-white transition hover:bg-black/80"
        >
          <X size={20} />
        </button>
        {/* Delete lives in the top bar so it never sits under floating system
            buttons (screenshot bubble etc.) in the bottom corners. */}
        {canDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              deletePost(post);
            }}
            aria-label="Delete post"
            className="absolute right-14 top-3 rounded-full bg-black/60 p-2 text-rose-300 transition hover:bg-black/80 hover:text-rose-400"
          >
            <Trash2 size={20} />
          </button>
        )}
        {canMoveToShorts && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              moveToShorts(post, photoIndex);
            }}
            aria-label="Move to Shorts"
            title="Move to Shorts"
            className="absolute right-[6.25rem] top-3 rounded-full bg-black/60 p-2 text-white transition hover:bg-black/80"
          >
            <Clapperboard size={20} />
          </button>
        )}
        <Link
          href={`/posts/p/${post.id}`}
          onClick={(e) => e.stopPropagation()}
          className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-2 text-xs font-semibold text-white transition hover:bg-black/80"
        >
          <ExternalLink size={14} /> Open post
        </Link>
        {post.media.length > 1 && (
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

        {/* Bottom bar: author, caption, like / comment. */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-4 pb-4 pt-14"
        >
          <Link
            href={`/people/${post.author.username ?? "unknown"}`}
            className="mb-1.5 flex items-center gap-2.5"
          >
            <PostAvatar username={post.author.username} size={32} />
            <span className="truncate text-sm font-semibold text-white">
              {post.author.display_name || post.author.username || "unknown"}
            </span>
          </Link>
          {post.caption && (
            <div
              onClick={() =>
                setExpandedId((cur) => (cur === post.id ? null : post.id))
              }
              className={cn(
                "mb-2 cursor-pointer text-sm text-white/90",
                expandedId === post.id
                  ? "max-h-[40vh] overflow-y-auto"
                  : "line-clamp-2"
              )}
            >
              <Markdown text={post.caption} />
            </div>
          )}
          {post.media.length > 1 && (
            <div className="mb-3 flex justify-center gap-1.5">
              {post.media.map((m, i) => (
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
              onClick={() => toggleLike(post)}
              className="flex items-center gap-1.5 text-white transition active:scale-90"
              aria-label="Like"
            >
              <Heart
                size={24}
                className={cn(post.viewer_liked && "fill-rose-500 text-rose-500")}
              />
              {post.like_count > 0 && (
                <span className="text-sm font-semibold">{post.like_count}</span>
              )}
            </button>
            <button
              onClick={() => setCommentsOpen(true)}
              className="flex items-center gap-1.5 text-white transition active:scale-90"
              aria-label="Comments"
            >
              <MessageCircle size={23} />
              {post.comment_count > 0 && (
                <span className="text-sm font-semibold">{post.comment_count}</span>
              )}
            </button>
          </div>
        </div>
      </div>

      {commentsOpen && (
        <CommentsSheet
          postId={post.id}
          onClose={() => setCommentsOpen(false)}
          onCountChange={(n) => onPatch(post.id, { comment_count: n })}
        />
      )}
    </>
  );
}
