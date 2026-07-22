"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Heart,
  MessageCircle,
  Play,
  FastForward,
  Rewind,
  Volume2,
  VolumeX,
  Minimize2,
  Trash2,
  Clapperboard,
  MoreVertical,
  Download,
  Maximize,
  Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useBackDismiss } from "@/lib/use-back-dismiss";
import { CommentsSheet } from "@/components/post-card";
import EditCaptionSheet from "@/components/edit-caption-sheet";
import type { FeedPost, FeedPostMedia } from "@/lib/posts";

// Player interaction tuning — identical to short-card so the Videos tab feels
// exactly like the Shorts feed.
const SEEK_SECONDS = 10;
const SEEK_ZONE = 0.35;
const DOUBLE_TAP_MS = 220;
const LONG_PRESS_MS = 550;
const BURST_MS = 700;
const SEEK_HINT_MS = 600;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// Caption with clickable hashtags → the posts tag view (must not bubble to the
// video tap handler).
const HASHTAG_RE = /#([\p{L}\p{N}_]+)/gu;
function renderCaption(text: string) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  HASHTAG_RE.lastIndex = 0;
  while ((m = HASHTAG_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tag = m[1];
    out.push(
      <Link
        key={`${m.index}-${tag}`}
        href={`/posts/tag/${encodeURIComponent(tag)}`}
        onClick={(e) => e.stopPropagation()}
        className="font-medium text-sky-300 transition active:scale-95"
      >
        #{tag}
      </Link>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// One full-screen card for one video media item of a post — the Videos tab's
// counterpart of ShortCard, wired to the posts APIs (like/comments act on the
// whole post; a carousel with several videos renders one card per video).
export default function VideoPostCard({
  post,
  media,
  active,
  muted,
  onToggleMuted,
  viewer,
  chromeHidden = false,
  onToggleChrome,
  onToggleFullscreen,
  onRemoved,
  onMediaRemoved,
  onPatch,
}: {
  post: FeedPost;
  media: FeedPostMedia;
  active: boolean;
  muted: boolean;
  onToggleMuted: () => void;
  viewer: { userId: number; isAdmin: boolean };
  chromeHidden?: boolean;
  onToggleChrome?: () => void;
  // Feed-level fullscreen toggle, exposed in the 3-dot menu too.
  onToggleFullscreen?: () => void;
  // The whole post left the feed (deleted / emptied by a move).
  onRemoved?: (postId: number) => void;
  // Only this video left the post (moved to shorts, siblings remain).
  onMediaRemoved?: (postId: number, mediaId: number) => void;
  // Like/comment-count changes, so sibling cards of the same post stay in sync.
  onPatch?: (postId: number, patch: Partial<FeedPost>) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seekHint, setSeekHint] = useState<1 | -1 | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);

  const [liked, setLiked] = useState(post.viewer_liked);
  const [likeCount, setLikeCount] = useState(post.like_count);
  const [commentCount, setCommentCount] = useState(post.comment_count);
  const [caption, setCaption] = useState(post.caption);
  const [burst, setBurst] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useBackDismiss(showComments, () => setShowComments(false));
  useBackDismiss(showDelete, () => setShowDelete(false));
  useBackDismiss(showMore, () => setShowMore(false));
  useBackDismiss(showEdit, () => setShowEdit(false));

  // Follow list-level updates (a like made on a sibling card, for instance).
  useEffect(() => {
    setLiked(post.viewer_liked);
    setLikeCount(post.like_count);
  }, [post.viewer_liked, post.like_count]);
  useEffect(() => {
    setCommentCount(post.comment_count);
  }, [post.comment_count]);
  useEffect(() => {
    setCaption(post.caption);
  }, [post.caption]);

  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  const handle = post.author.username ?? "unknown";
  const isOwner = post.author.type === "user" && post.author.id === viewer.userId;
  const canManage = isOwner || viewer.isAdmin;

  // Long-press toggles the clean view (only way back once the rail is hidden);
  // any movement cancels it so it never fires while scrolling between clips.
  const onPointerDown = () => {
    longPressed.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressed.current = true;
      onToggleChrome?.();
    }, LONG_PRESS_MS);
  };
  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // Drive playback from the active flag: the in-view card plays, all others
  // pause and rewind so they restart cleanly when scrolled back to.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (active) {
      v.play().catch(() => {/* autoplay can be blocked until interaction */});
    } else {
      v.pause();
      v.currentTime = 0;
    }
  }, [active]);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.muted = muted;
  }, [muted]);

  const triggerBurst = () => {
    setBurst(true);
    setTimeout(() => setBurst(false), BURST_MS);
  };

  const toggleLike = async (forceLike = false) => {
    if (forceLike && liked) {
      triggerBurst();
      return;
    }
    const next = !liked;
    setLiked(next);
    setLikeCount((c) => c + (next ? 1 : -1));
    if (next) triggerBurst();
    try {
      const res = await fetch(`/api/posts/${post.id}/like`, { method: "POST" });
      if (res.ok) {
        const d = await res.json();
        setLiked(d.liked);
        setLikeCount(d.like_count);
        onPatch?.(post.id, { viewer_liked: d.liked, like_count: d.like_count });
      }
    } catch {
      /* keep optimistic */
    }
  };

  const seek = (deltaSeconds: number) => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    v.currentTime = clamp(v.currentTime + deltaSeconds, 0, v.duration);
    setProgress((v.currentTime / v.duration) * 100);
    setSeekHint(deltaSeconds > 0 ? 1 : -1);
    setTimeout(() => setSeekHint(null), SEEK_HINT_MS);
  };

  const onTap = (e: React.MouseEvent) => {
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    if (tapTimer.current) {
      clearTimeout(tapTimer.current);
      tapTimer.current = null;
      const rect = e.currentTarget.getBoundingClientRect();
      const frac = rect.width ? (e.clientX - rect.left) / rect.width : 0.5;
      if (frac > 1 - SEEK_ZONE) seek(SEEK_SECONDS);
      else if (frac < SEEK_ZONE) seek(-SEEK_SECONDS);
      else toggleLike(true);
      return;
    }
    tapTimer.current = setTimeout(() => {
      tapTimer.current = null;
      const v = videoRef.current;
      if (!v) return;
      if (v.paused) v.play().catch(() => {});
      else v.pause();
    }, DOUBLE_TAP_MS);
  };

  const seekToClientX = (clientX: number) => {
    const bar = barRef.current;
    const v = videoRef.current;
    if (!bar || !v || !v.duration) return;
    const rect = bar.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    v.currentTime = frac * v.duration;
    setProgress(frac * 100);
  };
  const onScrubDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    scrubbing.current = true;
    setIsScrubbing(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    seekToClientX(e.clientX);
  };
  const onScrubMove = (e: React.PointerEvent) => {
    if (!scrubbing.current) return;
    e.stopPropagation();
    seekToClientX(e.clientX);
  };
  const onScrubUp = (e: React.PointerEvent) => {
    if (!scrubbing.current) return;
    scrubbing.current = false;
    setIsScrubbing(false);
    e.stopPropagation();
  };

  const flashMsg = (text: string) => {
    setMsg(text);
    setTimeout(() => setMsg(null), 2500);
  };

  // Owner/admin: move this video back to shorts (18+ post → 18+ channel).
  const moveToShorts = async () => {
    if (busyAction) return;
    setBusyAction(true);
    setMsg("Moving to Shorts…");
    try {
      const res = await fetch(`/api/posts/media/${media.id}/to-short`, { method: "POST" });
      if (res.ok) {
        setMsg(null);
        const d = await res.json().catch(() => ({}));
        if (d.postDeleted) onRemoved?.(post.id);
        else onMediaRemoved?.(post.id, media.id);
      } else {
        const d = await res.json().catch(() => ({}));
        flashMsg(d.error || "Move failed");
      }
    } catch {
      flashMsg("Move failed");
    }
    setBusyAction(false);
  };

  // Owner/admin: delete the whole post (confirmed in a sheet — destructive).
  const deletePost = async () => {
    if (busyAction) return;
    setBusyAction(true);
    try {
      const res = await fetch(`/api/posts/${post.id}`, { method: "DELETE" });
      if (res.ok) {
        setShowDelete(false);
        onRemoved?.(post.id);
      } else {
        const d = await res.json().catch(() => ({}));
        flashMsg(d.error || "Delete failed");
        setShowDelete(false);
      }
    } catch {
      flashMsg("Delete failed");
      setShowDelete(false);
    }
    setBusyAction(false);
  };

  return (
    <section className="relative flex h-full w-full snap-start snap-always items-center justify-center bg-black">
      <video
        ref={videoRef}
        src={`/api/posts/media/${media.id}`}
        poster={`/api/posts/media/${media.id}?size=thumb`}
        className="h-full w-full object-contain"
        loop
        muted={muted}
        playsInline
        preload="metadata"
        onClick={onTap}
        onPointerDown={onPointerDown}
        onPointerUp={cancelLongPress}
        onPointerMove={cancelLongPress}
        onPointerCancel={cancelLongPress}
        onPointerLeave={cancelLongPress}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          if (v.duration) setProgress((v.currentTime / v.duration) * 100);
        }}
      />

      {msg && (
        <div className="pointer-events-none absolute left-1/2 top-20 z-10 -translate-x-1/2 rounded-full bg-black/75 px-4 py-1.5 text-sm font-medium text-white">
          {msg}
        </div>
      )}

      {burst && (
        <Heart
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 animate-ping fill-white text-white"
          size={96}
        />
      )}

      {seekHint && (
        <div
          className={cn(
            "pointer-events-none absolute top-1/2 flex -translate-y-1/2 flex-col items-center gap-1 rounded-2xl bg-black/55 px-5 py-3 text-white backdrop-blur-sm",
            seekHint > 0 ? "right-[12%]" : "left-[12%]"
          )}
        >
          {seekHint > 0 ? (
            <FastForward size={28} className="fill-white" />
          ) : (
            <Rewind size={28} className="fill-white" />
          )}
          <span className="text-sm font-semibold tabular-nums">
            {seekHint > 0 ? `+${SEEK_SECONDS}` : `-${SEEK_SECONDS}`}s
          </span>
        </div>
      )}

      {!playing && active && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          aria-hidden
        >
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-black/35 backdrop-blur-sm">
            <Play size={40} className="ml-1 fill-white text-white drop-shadow-lg" />
          </span>
        </div>
      )}

      {!chromeHidden && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
      )}

      {/* Draggable timeline (scrub by dragging the handle) */}
      {!chromeHidden && (
        <div
          className="absolute bottom-0 left-0 right-0 z-20 cursor-pointer touch-none px-3 pb-2.5 pt-4"
          onPointerDown={onScrubDown}
          onPointerMove={onScrubMove}
          onPointerUp={onScrubUp}
          onPointerCancel={onScrubUp}
        >
          {isScrubbing && duration > 0 && (
            <div className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs font-semibold tabular-nums text-white">
              {fmtTime((progress / 100) * duration)} / {fmtTime(duration)}
            </div>
          )}
          <div
            ref={barRef}
            className={cn(
              "relative w-full rounded-full bg-white/25 transition-[height]",
              isScrubbing ? "h-1.5" : "h-1"
            )}
          >
            <div className="h-full rounded-full bg-white" style={{ width: `${progress}%` }} />
            <div
              className={cn(
                "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-md transition-[height,width]",
                isScrubbing ? "h-5 w-5 ring-2 ring-white/40" : "h-3.5 w-3.5"
              )}
              style={{ left: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Right rail */}
      {!chromeHidden && (
        <div className="absolute bottom-16 right-2 flex flex-col items-center gap-3 text-white">
          <RailButton
            icon={<Heart size={22} className={cn(liked && "fill-rose-500 text-rose-500")} />}
            label={String(likeCount)}
            onClick={() => toggleLike()}
          />
          <RailButton
            icon={<MessageCircle size={22} />}
            label={String(commentCount)}
            onClick={() => setShowComments(true)}
          />
          <a
            href={`/api/posts/media/${media.id}?download=1`}
            className="flex flex-col items-center gap-0.5 transition active:scale-90"
          >
            <span className="drop-shadow-lg">
              <Download size={22} />
            </span>
            <span className="text-[10px] font-medium leading-tight drop-shadow">
              Download
            </span>
          </a>
          <RailButton
            icon={muted ? <VolumeX size={22} /> : <Volume2 size={22} />}
            label={muted ? "Muted" : "Sound"}
            onClick={onToggleMuted}
          />
          <RailButton
            icon={<MoreVertical size={22} />}
            label="More"
            onClick={() => setShowMore(true)}
          />
        </div>
      )}

      {/* 3-dot menu: view controls for everyone, management for owner/admin. */}
      {showMore && (
        <div
          className="absolute inset-0 z-20 flex items-end justify-center bg-black/60"
          onClick={() => setShowMore(false)}
        >
          <div
            className="max-h-[75%] w-full max-w-md overflow-y-auto rounded-t-2xl bg-neutral-900 py-2 text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreRow
              icon={<Minimize2 size={18} />}
              label={chromeHidden ? "Show overlay" : "Hide overlay"}
              onClick={() => {
                setShowMore(false);
                onToggleChrome?.();
              }}
            />
            {onToggleFullscreen && (
              <MoreRow
                icon={<Maximize size={18} />}
                label="Fullscreen"
                onClick={() => {
                  setShowMore(false);
                  onToggleFullscreen();
                }}
              />
            )}
            {canManage && (
              <>
                <div className="my-1 border-t border-white/10" />
                <MoreRow
                  icon={<Pencil size={18} />}
                  label="Edit caption"
                  onClick={() => {
                    setShowMore(false);
                    setShowEdit(true);
                  }}
                />
                <MoreRow
                  icon={<Clapperboard size={18} className={cn(busyAction && "opacity-50")} />}
                  label="Move to Shorts"
                  onClick={() => {
                    setShowMore(false);
                    moveToShorts();
                  }}
                />
                <MoreRow
                  icon={<Trash2 size={18} className="text-red-400" />}
                  label="Delete post"
                  danger
                  onClick={() => {
                    setShowMore(false);
                    setShowDelete(true);
                  }}
                />
              </>
            )}
          </div>
        </div>
      )}

      {/* Caption / author */}
      {!chromeHidden && (
        <div className="absolute bottom-6 left-4 right-20 text-white">
          <Link
            href={`/people/${handle}`}
            className="inline-block text-sm font-semibold drop-shadow transition active:scale-95"
          >
            @{post.author.display_name || handle}
          </Link>
          {caption && (
            <p className="mt-1 line-clamp-3 text-sm drop-shadow">
              {renderCaption(caption)}
            </p>
          )}
        </div>
      )}

      {showEdit && (
        <EditCaptionSheet
          postId={post.id}
          initial={caption ?? ""}
          onClose={() => setShowEdit(false)}
          onSaved={(next) => {
            setCaption(next);
            onPatch?.(post.id, { caption: next });
            setShowEdit(false);
          }}
        />
      )}

      {showDelete && (
        <div
          className="absolute inset-0 z-20 flex items-end justify-center bg-black/60"
          onClick={() => setShowDelete(false)}
        >
          <div
            className="w-full max-w-md rounded-t-2xl bg-neutral-900 p-5 pb-8 text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-base font-semibold">Delete this post?</p>
            <p className="mt-1 text-sm text-white/60">
              The post and its media files are removed. This can&apos;t be undone.
            </p>
            <div className="mt-4 flex gap-3">
              <button
                onClick={deletePost}
                disabled={busyAction}
                className="flex-1 rounded-full bg-red-600 py-2.5 text-sm font-semibold transition active:scale-95 disabled:opacity-50"
              >
                Delete
              </button>
              <button
                onClick={() => setShowDelete(false)}
                className="flex-1 rounded-full bg-white/10 py-2.5 text-sm font-semibold transition active:scale-95"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {showComments && (
        <CommentsSheet
          postId={post.id}
          onClose={() => setShowComments(false)}
          onCountChange={(n) => {
            setCommentCount(n);
            onPatch?.(post.id, { comment_count: n });
          }}
        />
      )}
    </section>
  );
}

function RailButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-0.5 transition active:scale-90"
    >
      <span className="drop-shadow-lg">{icon}</span>
      <span className="text-[10px] font-medium leading-tight drop-shadow">{label}</span>
    </button>
  );
}

// One row in the 3-dot menu sheet (matches short-card's MoreRow).
function MoreRow({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 px-5 py-3 text-left text-sm transition hover:bg-white/5",
        danger ? "text-red-400" : "text-white"
      )}
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10">
        {icon}
      </span>
      {label}
    </button>
  );
}
