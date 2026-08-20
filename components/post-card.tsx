"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Heart, MessageCircle, X, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBackDismiss } from "@/lib/use-back-dismiss";
import { SOURCE_RE } from "@/lib/shorts-caption";
import PostAvatar from "@/components/post-avatar";
import PostInlineVideo from "@/components/post-inline-video";
import Markdown from "@/components/markdown";
import MentionInput from "@/components/mention-input";
import type { FeedPost } from "@/lib/posts";

// "https://www.instagram.com/p/CX12ab/" → "instagram.com/p/CX12ab": enough of
// the link to recognise where a post came from, short enough for a meta line.
function sourceLabel(url: string): string {
  try {
    const u = new URL(url);
    return (u.host.replace(/^www\./, "") + u.pathname).replace(/\/$/, "");
  } catch {
    return url;
  }
}

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
  // Long captions read as two lines with a "more" toggle, like the lightbox.
  const [captionOpen, setCaptionOpen] = useState(false);
  const [captionClamped, setCaptionClamped] = useState(false);
  const captionRef = useRef<HTMLDivElement>(null);
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

  // An imported post carries its permalink as the caption's trailing
  // "Source: <url>" row (see lib/user-import.ts). The sketch puts it in the
  // header meta line, so it comes out of the caption body here.
  const source = post.caption?.match(SOURCE_RE)?.[1] ?? null;
  const caption = source
    ? post.caption!.replace(SOURCE_RE, " ").replace(/\n{3,}/g, "\n\n").trim()
    : post.caption;

  // Whether the caption actually overflows its two lines — measured, not
  // guessed from a character count, since a hashtag row or a long word wraps
  // differently on every width. Only while collapsed: an expanded block always
  // reports that it fits, which would hide the "less" toggle.
  useEffect(() => {
    const el = captionRef.current;
    if (!el || captionOpen) return;
    const check = () => setCaptionClamped(el.scrollHeight > el.clientHeight + 2);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [caption, captionOpen]);

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
    // Spacing per the Layout Studio sketch (docs/elite-v2): no card frame, 6px
    // outside the card and 12px in, so every row — header, photo, actions,
    // caption — lines up 18px from the screen edge.
    <article className="mx-1.5 overflow-hidden pb-3">
      {/* Header — the meta line carries the time and, when the caption came
          with one, the post's source link. */}
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
          {source && (
            <a
              href={source}
              target="_blank"
              rel="noreferrer noopener"
              className="block truncate text-[11px] text-white/40 transition hover:text-white/70"
            >
              {sourceLabel(source)}
            </a>
          )}
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
      <div className="relative mx-3 overflow-hidden rounded-xl bg-black">
        <div
          ref={trackRef}
          onScroll={onScroll}
          className="flex snap-x snap-mandatory overflow-x-auto"
          style={{ scrollbarWidth: "none" }}
        >
          {post.media.map((m, i) =>
            m.is_video ? (
              // Videos play inline (muted autoplay in view, native controls), so
              // they get no tap/like handlers — the controls own the clicks.
              <PostInlineVideo
                key={m.id}
                src={`/api/posts/media/${m.id}`}
                poster={`/api/posts/media/${m.id}?size=thumb`}
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

      {/* Actions — each icon carries its own count, per the sketch. */}
      <div className="flex items-center gap-5 px-3 pt-2.5">
        <button
          onClick={toggleLike}
          className="flex items-center gap-1.5 transition active:scale-90"
          aria-label="Like"
        >
          <Heart
            size={24}
            className={cn(liked ? "fill-rose-500 text-rose-500" : "text-white")}
          />
          {likeCount > 0 && (
            <span className="text-sm font-semibold tabular-nums text-white">{likeCount}</span>
          )}
        </button>
        <button
          onClick={() => setShowComments(true)}
          className="flex items-center gap-1.5 transition active:scale-90"
          aria-label="Comments"
        >
          <MessageCircle size={23} className="text-white" />
          {commentCount > 0 && (
            <span className="text-sm font-semibold tabular-nums text-white">{commentCount}</span>
          )}
        </button>
      </div>

      {/* Meta — the handle sits on its own line above the caption. The like
          total lives beside the heart above; a separate "128 likes" line would
          print the same number twice. */}
      <div className="px-3 pt-2">
        {caption && (
          <div className="text-sm text-white/90">
            <Link href={`/people/${handle}`} className="block font-semibold text-white">
              {handle}
            </Link>
            <div ref={captionRef} className={cn("mt-0.5", !captionOpen && "line-clamp-2")}>
              <Markdown text={caption} />
            </div>
            {(captionClamped || captionOpen) && (
              <button
                onClick={() => setCaptionOpen((v) => !v)}
                className="mt-0.5 text-sm font-medium text-white/50 transition hover:text-white/80"
              >
                {captionOpen ? "less" : "more"}
              </button>
            )}
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
