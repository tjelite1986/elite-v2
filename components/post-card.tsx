"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Heart, MessageCircle, X, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBackDismiss } from "@/lib/use-back-dismiss";
import PostAvatar from "@/components/post-avatar";
import Markdown from "@/components/markdown";
import MentionInput from "@/components/mention-input";
import type { FeedPost } from "@/lib/posts";

function relativeTime(s: string): string {
  const diff = Date.now() - new Date(s.replace(" ", "T") + "Z").getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export default function PostCard({
  post,
  onImageTap,
  onPatch,
}: {
  post: FeedPost;
  // Single tap on a photo (index within the carousel) — opens the lightbox
  // when the feed provides it. Double tap still likes.
  onImageTap?: (photoIndex: number) => void;
  // Report like/comment-count changes back to the owning list so the lightbox
  // and the card stay in sync.
  onPatch?: (patch: Partial<FeedPost>) => void;
}) {
  const [liked, setLiked] = useState(post.viewer_liked);
  const [likeCount, setLikeCount] = useState(post.like_count);
  const [commentCount, setCommentCount] = useState(post.comment_count);
  const [showComments, setShowComments] = useState(false);
  const [active, setActive] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Follow list-level updates (a like made inside the lightbox, for instance).
  useEffect(() => {
    setLiked(post.viewer_liked);
    setLikeCount(post.like_count);
  }, [post.viewer_liked, post.like_count]);
  useEffect(() => {
    setCommentCount(post.comment_count);
  }, [post.comment_count]);

  // Device Back closes the comments sheet instead of leaving the feed.
  useBackDismiss(showComments, () => setShowComments(false));

  const handle = post.author.username ?? "unknown";

  const toggleLike = async () => {
    const next = !liked;
    setLiked(next);
    setLikeCount((c) => c + (next ? 1 : -1));
    try {
      const res = await fetch(`/api/posts/${post.id}/like`, { method: "POST" });
      if (res.ok) {
        const d = await res.json();
        setLiked(d.liked);
        setLikeCount(d.like_count);
        onPatch?.({ viewer_liked: d.liked, like_count: d.like_count });
      }
    } catch {
      /* keep optimistic */
    }
  };

  // Distinguish tap (open lightbox) from double-tap (like): delay the tap
  // briefly and cancel it when a second tap lands.
  const handleImageClick = (index: number) => {
    if (!onImageTap) return;
    if (tapTimer.current) return;
    tapTimer.current = setTimeout(() => {
      tapTimer.current = null;
      onImageTap(index);
    }, 250);
  };
  const handleImageDoubleClick = () => {
    if (tapTimer.current) {
      clearTimeout(tapTimer.current);
      tapTimer.current = null;
    }
    if (!liked) toggleLike();
  };

  const onScroll = () => {
    const el = trackRef.current;
    if (!el) return;
    setActive(Math.round(el.scrollLeft / el.clientWidth));
  };

  return (
    // A card with its own margin and rounded corners instead of a full-bleed
    // slab: the feed reads as separate posts without the hard divider line.
    <article className="mx-2 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] pb-3">
      {/* Header */}
      <header className="flex items-center gap-2.5 px-3 py-2.5">
        <Link href={`/people/${handle}`}>
          <PostAvatar username={post.author.username} size={34} />
        </Link>
        <div className="min-w-0 flex-1">
          <Link
            href={`/people/${handle}`}
            className="block truncate text-sm font-semibold text-white"
          >
            {post.author.display_name || handle}
          </Link>
        </div>
        <Link
          href={`/posts/p/${post.id}`}
          className="text-xs text-white/40 transition hover:text-white/70"
          title="Open post"
        >
          {relativeTime(post.created_at)}
        </Link>
      </header>

      {/* Media carousel — inset from the card edge, rounded like the card. */}
      <div className="relative mx-2 overflow-hidden rounded-xl bg-black">
        <div
          ref={trackRef}
          onScroll={onScroll}
          className="flex snap-x snap-mandatory overflow-x-auto"
          style={{ scrollbarWidth: "none" }}
        >
          {post.media.map((m, i) =>
            m.is_video ? (
              // Videos play inline (native controls), so they get no tap/like
              // handlers — the controls own the clicks.
              <video
                key={m.id}
                src={`/api/posts/media/${m.id}`}
                poster={`/api/posts/media/${m.id}?size=thumb`}
                controls
                playsInline
                preload="none"
                className="aspect-square w-full shrink-0 snap-center bg-black object-contain"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={m.id}
                src={`/api/posts/media/${m.id}`}
                alt=""
                loading="lazy"
                onClick={() => handleImageClick(i)}
                onDoubleClick={handleImageDoubleClick}
                className="aspect-square w-full shrink-0 snap-center object-cover"
              />
            )
          )}
        </div>
        {post.media.length > 1 && (
          <div className="pointer-events-none absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1">
            {post.media.map((m, i) => (
              <span
                key={m.id}
                className={cn(
                  "size-1.5 rounded-full",
                  i === active ? "bg-white" : "bg-white/40"
                )}
              />
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-4 px-3 pt-2.5">
        <button onClick={toggleLike} className="transition active:scale-90" aria-label="Like">
          <Heart
            size={24}
            className={cn(liked ? "fill-rose-500 text-rose-500" : "text-white")}
          />
        </button>
        <button
          onClick={() => setShowComments(true)}
          className="transition active:scale-90"
          aria-label="Comments"
        >
          <MessageCircle size={23} className="text-white" />
        </button>
      </div>

      {/* Meta */}
      <div className="px-3 pt-1.5">
        {likeCount > 0 && (
          <div className="text-sm font-semibold text-white">
            {likeCount} like{likeCount === 1 ? "" : "s"}
          </div>
        )}
        {post.caption && (
          <div className="mt-0.5 text-sm text-white/90">
            <Link href={`/people/${handle}`} className="mr-1.5 font-semibold text-white">
              {handle}
            </Link>
            <Markdown text={post.caption} className="inline [&_p]:inline" />
          </div>
        )}
        {commentCount > 0 && (
          <button
            onClick={() => setShowComments(true)}
            className="mt-1 text-sm text-white/50"
          >
            View {commentCount === 1 ? "1 comment" : `all ${commentCount} comments`}
          </button>
        )}
      </div>

      {showComments && (
        <CommentsSheet
          postId={post.id}
          onClose={() => setShowComments(false)}
          onCountChange={(n) => {
            setCommentCount(n);
            onPatch?.({ comment_count: n });
          }}
        />
      )}
    </article>
  );
}

interface Comment {
  id: number;
  body: string;
  created_at: string;
  author_username: string | null;
}

export function CommentsSheet({
  postId,
  onClose,
  onCountChange,
}: {
  postId: number;
  onClose: () => void;
  onCountChange: (n: number) => void;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/posts/${postId}/comments`)
      .then((r) => r.json())
      .then((d) => setComments(d.comments || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [postId]);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const body = input.trim();
    if (!body) return;
    setInput("");
    try {
      const res = await fetch(`/api/posts/${postId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (res.ok) {
        const d = await res.json();
        setComments((c) => {
          const next = [...c, d.comment];
          onCountChange(next.length);
          return next;
        });
      }
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onClose}>
      <div
        className="flex max-h-[70%] flex-col rounded-t-2xl bg-neutral-900 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <span className="font-semibold">
            {comments.length} comment{comments.length === 1 ? "" : "s"}
          </span>
          <button onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {loading && <p className="text-sm text-white/50">Loading…</p>}
          {!loading && comments.length === 0 && (
            <p className="text-sm text-white/50">Be the first to comment.</p>
          )}
          {comments.map((c) => (
            <div key={c.id} className="flex items-start gap-2.5 text-sm">
              <PostAvatar username={c.author_username} size={28} />
              <div className="text-white/90">
                <Link
                  href={`/people/${c.author_username ?? "unknown"}`}
                  className="mr-1.5 font-semibold text-white"
                >
                  {c.author_username ?? "unknown"}
                </Link>
                <Markdown text={c.body} className="inline [&_p]:inline" />
              </div>
            </div>
          ))}
        </div>
        <form
          onSubmit={submit}
          className="flex items-center gap-2 border-t border-white/10 p-3"
        >
          <MentionInput
            value={input}
            onChange={setInput}
            onSubmit={() => submit()}
            placeholder="Add a comment…"
            wrapperClassName="flex-1"
            className="w-full rounded-full bg-white/10 px-4 py-2 text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
          />
          <button
            type="submit"
            className="rounded-full bg-rose-500 p-2 transition active:scale-90"
            aria-label="Post comment"
          >
            <Send size={18} />
          </button>
        </form>
      </div>
    </div>
  );
}
