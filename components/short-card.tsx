"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Heart,
  MessageCircle,
  Share2,
  Volume2,
  VolumeX,
  Play,
  X,
  Send,
  Bookmark,
  Plus,
  Tag,
  Check,
  Image as ImageIcon,
  Minimize2,
  Type,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SHORT_CATEGORIES, CATEGORY_LABELS } from "@/lib/shorts-categories";

export interface FeedShort {
  id: number;
  channel: string;
  category: string;
  caption: string | null;
  uploader_id: number | null;
  uploader_email: string | null;
  profile_id: number | null;
  profile_name: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  created_at: string;
  like_count: number;
  comment_count: number;
  viewer_liked: boolean;
  viewer_saved: boolean;
  has_poster: boolean;
}

interface Comment {
  id: number;
  body: string;
  author_email: string | null;
  created_at: string;
}

interface ChatUser {
  id: number;
  email: string;
}

function displayName(email: string | null): string {
  if (!email) return "Unknown";
  return email.split("@")[0];
}

// Attribution for a clip: the uploader for user uploads, otherwise the auto-poll
// profile name (so polled clips don't all read "@Unknown").
function authorLabel(short: FeedShort): string {
  if (short.uploader_email) return displayName(short.uploader_email);
  if (short.profile_name) return short.profile_name;
  return "unknown";
}

// Shared handle namespace (matches handleOf in lib/directory.ts) so a clip
// creator links to its unified /people profile.
function personHandle(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, "")
    .replace(/^[._]+|[._]+$/g, "");
}

export default function ShortCard({
  short,
  active,
  muted,
  onToggleMuted,
  categoryEditable = false,
  isAdmin = false,
  chromeHidden = false,
  onToggleChrome,
}: {
  short: FeedShort;
  active: boolean;
  muted: boolean;
  onToggleMuted: () => void;
  // Admins in the 18+ section get a category button to sort the clip in place.
  categoryEditable?: boolean;
  // Admins get a "Cover" button to set the thumbnail from the current frame.
  isAdmin?: boolean;
  // Clean view: hide all overlay UI. Long-press the clip to toggle it back.
  chromeHidden?: boolean;
  onToggleChrome?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [seekHint, setSeekHint] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);

  const [liked, setLiked] = useState(short.viewer_liked);
  const [likeCount, setLikeCount] = useState(short.like_count);
  const [burst, setBurst] = useState(false);

  const [showComments, setShowComments] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [saved, setSaved] = useState(short.viewer_saved);
  const [commentCount, setCommentCount] = useState(short.comment_count);
  const [showCategory, setShowCategory] = useState(false);
  const [category, setCategory] = useState(short.category);
  const [coverMsg, setCoverMsg] = useState<string | null>(null);
  const [caption, setCaption] = useState(short.caption);

  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  // Long-press toggles the clean (chrome-hidden) view, the only way back once
  // the rail is hidden. Any movement cancels it so it never fires while
  // scrolling between clips.
  const onPointerDown = () => {
    longPressed.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressed.current = true;
      onToggleChrome?.();
    }, 550);
  };
  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // Admin "set cover": grab the frame the admin paused on and make it the
  // poster. Server re-extracts it from the file at that timestamp.
  const setCover = async () => {
    const v = videoRef.current;
    if (!v) return;
    const time = v.currentTime || 0;
    v.pause();
    setCoverMsg("Saving cover…");
    try {
      const res = await fetch(`/api/shorts/${short.id}/poster`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ time }),
      });
      if (res.ok) {
        // The poster URL is keyed by id, so bust the cache to show the new one.
        if (videoRef.current) {
          videoRef.current.poster = `/api/shorts/${short.id}/poster?v=${Date.now()}`;
        }
        setCoverMsg("Cover set");
      } else {
        setCoverMsg("Failed");
      }
    } catch {
      setCoverMsg("Failed");
    }
    setTimeout(() => setCoverMsg(null), 2000);
  };

  // Admin "Title": fetch the original title from the source (e.g. the TikTok
  // video) and use it as the caption. Useful for legacy imports whose titles
  // were truncated or missing.
  const fetchTitle = async () => {
    setCoverMsg("Fetching title…");
    try {
      const res = await fetch(`/api/shorts/${short.id}/fetch-title`, {
        method: "POST",
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setCaption(d.caption ?? null);
        setCoverMsg("Title updated");
      } else {
        setCoverMsg(d.error || "No title found");
      }
    } catch {
      setCoverMsg("Failed");
    }
    setTimeout(() => setCoverMsg(null), 2500);
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

  const toggleLike = async (forceLike = false) => {
    if (forceLike && liked) {
      triggerBurst();
      return;
    }
    // Optimistic update.
    const next = !liked;
    setLiked(next);
    setLikeCount((c) => c + (next ? 1 : -1));
    if (next) triggerBurst();
    try {
      const res = await fetch(`/api/shorts/${short.id}/like`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setLiked(data.liked);
        setLikeCount(data.like_count);
      }
    } catch {
      /* keep optimistic state */
    }
  };

  const triggerBurst = () => {
    setBurst(true);
    setTimeout(() => setBurst(false), 700);
  };

  // Jump the playhead by a number of seconds, clamped, with a brief on-screen hint.
  const seek = (delta: number) => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    v.currentTime = Math.min(v.duration, Math.max(0, v.currentTime + delta));
    if (v.duration) setProgress((v.currentTime / v.duration) * 100);
    setSeekHint(delta > 0 ? `+${delta}s` : `${delta}s`);
    setTimeout(() => setSeekHint(null), 500);
  };

  const onTap = (e: React.MouseEvent) => {
    // A long-press just toggled the chrome — swallow the trailing click.
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    // Second tap within the window: zone decides — left third rewinds, right
    // third skips forward, middle keeps the double-tap-to-like.
    if (tapTimer.current) {
      clearTimeout(tapTimer.current);
      tapTimer.current = null;
      const rect = e.currentTarget.getBoundingClientRect();
      const frac = rect.width ? (e.clientX - rect.left) / rect.width : 0.5;
      if (frac > 0.65) seek(10);
      else if (frac < 0.35) seek(-10);
      else toggleLike(true);
      return;
    }
    tapTimer.current = setTimeout(() => {
      tapTimer.current = null;
      const v = videoRef.current;
      if (!v) return;
      if (v.paused) v.play().catch(() => {});
      else v.pause();
    }, 220);
  };

  // Draggable timeline: scrub the playhead from the pointer's x position.
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
    e.stopPropagation();
  };

  return (
    <section className="relative flex h-full w-full snap-start snap-always items-center justify-center bg-black">
      {/* Video */}
      <video
        ref={videoRef}
        src={`/api/shorts/${short.id}/video`}
        poster={short.has_poster ? `/api/shorts/${short.id}/poster` : undefined}
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
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          if (v.duration) setProgress((v.currentTime / v.duration) * 100);
        }}
      />

      {/* Cover-set feedback */}
      {coverMsg && (
        <div className="pointer-events-none absolute left-1/2 top-20 z-10 -translate-x-1/2 rounded-full bg-black/75 px-4 py-1.5 text-sm font-medium text-white">
          {coverMsg}
        </div>
      )}

      {/* Double-tap like burst */}
      {burst && (
        <Heart
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 animate-ping fill-white text-white"
          size={96}
        />
      )}

      {/* Double-tap seek hint */}
      {seekHint && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/70 px-4 py-2 text-lg font-bold text-white">
          {seekHint}
        </div>
      )}

      {/* Paused indicator */}
      {!playing && active && (
        <button
          onClick={onTap}
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          aria-hidden
        >
          <Play size={64} className="fill-white/80 text-white/80 drop-shadow-lg" />
        </button>
      )}

      {/* Draggable timeline (scrub by dragging the handle) */}
      {!chromeHidden && (
        <div
          className="absolute bottom-0 left-0 right-0 z-20 cursor-pointer touch-none px-3 pb-2 pt-3"
          onPointerDown={onScrubDown}
          onPointerMove={onScrubMove}
          onPointerUp={onScrubUp}
          onPointerCancel={onScrubUp}
        >
          <div ref={barRef} className="relative h-1 w-full rounded-full bg-white/25">
            <div
              className="h-full rounded-full bg-white"
              style={{ width: `${progress}%` }}
            />
            <div
              className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-md"
              style={{ left: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Right rail */}
      {!chromeHidden && (
      <div className="absolute bottom-16 right-2 flex flex-col items-center gap-3 text-white">
        <RailButton
          icon={
            <Heart
              size={22}
              className={cn(liked && "fill-rose-500 text-rose-500")}
            />
          }
          label={String(likeCount)}
          onClick={() => toggleLike()}
        />
        <RailButton
          icon={<MessageCircle size={22} />}
          label={String(commentCount)}
          onClick={() => setShowComments(true)}
        />
        <RailButton
          icon={
            <Bookmark
              size={22}
              className={cn(saved && "fill-yellow-400 text-yellow-400")}
            />
          }
          label="Save"
          onClick={() => setShowSave(true)}
        />
        <RailButton
          icon={<Share2 size={22} />}
          label="Share"
          onClick={() => setShowShare(true)}
        />
        {categoryEditable && (
          <RailButton
            icon={<Tag size={22} />}
            label={CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS] ?? "Category"}
            onClick={() => setShowCategory(true)}
          />
        )}
        {isAdmin && (
          <RailButton
            icon={<ImageIcon size={22} />}
            label="Cover"
            onClick={setCover}
          />
        )}
        {isAdmin && (
          <RailButton
            icon={<Type size={22} />}
            label="Title"
            onClick={fetchTitle}
          />
        )}
        <RailButton
          icon={muted ? <VolumeX size={22} /> : <Volume2 size={22} />}
          label={muted ? "Muted" : "Sound"}
          onClick={onToggleMuted}
        />
        {onToggleChrome && (
          <RailButton
            icon={<Minimize2 size={22} />}
            label="Hide UI"
            onClick={onToggleChrome}
          />
        )}
      </div>
      )}

      {/* Caption / uploader */}
      {!chromeHidden && (
        <div className="absolute bottom-6 left-4 right-20 text-white">
          {short.profile_id && short.profile_name ? (
            <Link
              href={`/people/${personHandle(short.profile_name)}`}
              className="inline-block text-sm font-semibold drop-shadow transition active:scale-95"
            >
              @{authorLabel(short)}
            </Link>
          ) : (
            <div className="text-sm font-semibold drop-shadow">
              @{authorLabel(short)}
            </div>
          )}
          {caption && (
            <p className="mt-1 line-clamp-3 text-sm drop-shadow">{caption}</p>
          )}
        </div>
      )}

      {showComments && (
        <CommentsSheet
          shortId={short.id}
          onClose={() => setShowComments(false)}
          onCountChange={setCommentCount}
        />
      )}
      {showShare && (
        <ShareSheet shortId={short.id} onClose={() => setShowShare(false)} />
      )}
      {showSave && (
        <SaveSheet
          shortId={short.id}
          onClose={() => setShowSave(false)}
          onSavedChange={setSaved}
        />
      )}
      {showCategory && (
        <CategorySheet
          shortId={short.id}
          current={category}
          onClose={() => setShowCategory(false)}
          onChange={setCategory}
        />
      )}
    </section>
  );
}

// Admin category picker for the 18+ feed: tap a bucket to sort the clip in place.
function CategorySheet({
  shortId,
  current,
  onClose,
  onChange,
}: {
  shortId: number;
  current: string;
  onClose: () => void;
  onChange: (category: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  const set = async (category: string) => {
    if (busy || category === current) {
      onClose();
      return;
    }
    setBusy(true);
    const prev = current;
    onChange(category); // optimistic
    const res = await fetch(`/api/shorts/${shortId}/category`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category }),
    });
    if (!res.ok) onChange(prev);
    setBusy(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onClose}>
      <div
        className="flex flex-col rounded-t-2xl bg-neutral-900 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <span className="font-semibold">Category</span>
          <button onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="px-2 py-2">
          {SHORT_CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => set(c)}
              disabled={busy}
              className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left hover:bg-white/5 disabled:opacity-50"
            >
              <span className="text-sm font-medium">{CATEGORY_LABELS[c]}</span>
              {current === c && <Check size={18} className="text-rose-500" />}
            </button>
          ))}
        </div>
      </div>
    </div>
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
      <span className="text-[10px] font-medium leading-tight drop-shadow">
        {label}
      </span>
    </button>
  );
}

function CommentsSheet({
  shortId,
  onClose,
  onCountChange,
}: {
  shortId: number;
  onClose: () => void;
  onCountChange: (n: number) => void;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/shorts/${shortId}/comments`)
      .then((r) => r.json())
      .then((d) => setComments(d.comments || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [shortId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = input.trim();
    if (!body) return;
    setInput("");
    try {
      const res = await fetch(`/api/shorts/${shortId}/comments`, {
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
          <button onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
          {loading && <p className="text-sm text-white/50">Loading…</p>}
          {!loading && comments.length === 0 && (
            <p className="text-sm text-white/50">Be the first to comment.</p>
          )}
          {comments.map((c) => (
            <div key={c.id} className="text-sm">
              <span className="font-semibold">@{displayName(c.author_email)}</span>{" "}
              <span className="text-white/90">{c.body}</span>
            </div>
          ))}
        </div>
        <form
          onSubmit={submit}
          className="flex items-center gap-2 border-t border-white/10 p-3"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Add a comment…"
            className="flex-1 rounded-full bg-white/10 px-4 py-2 text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
          />
          <button
            type="submit"
            className="rounded-full bg-rose-500 p-2 transition active:scale-90"
          >
            <Send size={18} />
          </button>
        </form>
      </div>
    </div>
  );
}

function ShareSheet({
  shortId,
  onClose,
}: {
  shortId: number;
  onClose: () => void;
}) {
  const [users, setUsers] = useState<ChatUser[]>([]);
  const [sentTo, setSentTo] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/messages/users")
      .then((r) => r.json())
      .then((d) => setUsers(d.users || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const share = async (recipientId: number) => {
    try {
      const res = await fetch(`/api/shorts/${shortId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientId }),
      });
      if (res.ok) setSentTo((s) => new Set(s).add(recipientId));
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
          <span className="font-semibold">Share to chat</span>
          <button onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {loading && <p className="px-2 text-sm text-white/50">Loading…</p>}
          {!loading && users.length === 0 && (
            <p className="px-2 text-sm text-white/50">No one to share with yet.</p>
          )}
          {users.map((u) => (
            <div
              key={u.id}
              className="flex items-center justify-between rounded-xl px-3 py-2 hover:bg-white/5"
            >
              <span className="text-sm">@{displayName(u.email)}</span>
              <button
                onClick={() => share(u.id)}
                disabled={sentTo.has(u.id)}
                className={cn(
                  "rounded-full px-4 py-1.5 text-xs font-semibold transition active:scale-95",
                  sentTo.has(u.id)
                    ? "bg-white/10 text-white/50"
                    : "bg-rose-500 text-white"
                )}
              >
                {sentTo.has(u.id) ? "Sent" : "Send"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface SavePlaylist {
  id: number;
  name: string;
  item_count: number;
  contains: number;
}

// Save-to-playlist ("Favorites") picker: toggle the clip into any of the user's
// playlists, or create a new one.
function SaveSheet({
  shortId,
  onClose,
  onSavedChange,
}: {
  shortId: number;
  onClose: () => void;
  onSavedChange: (saved: boolean) => void;
}) {
  const [playlists, setPlaylists] = useState<SavePlaylist[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const res = await fetch(`/api/shorts/playlists?short=${shortId}`);
    if (res.ok) {
      const pls: SavePlaylist[] = (await res.json()).playlists || [];
      setPlaylists(pls);
      onSavedChange(pls.some((p) => !!p.contains));
    }
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = async (p: SavePlaylist) => {
    const inIt = !!p.contains;
    const next = playlists.map((x) =>
      x.id === p.id
        ? { ...x, contains: inIt ? 0 : 1, item_count: x.item_count + (inIt ? -1 : 1) }
        : x
    );
    setPlaylists(next);
    // The bookmark is yellow whenever the clip is in at least one playlist.
    onSavedChange(next.some((x) => !!x.contains));
    await fetch(`/api/shorts/playlists/${p.id}/items` + (inIt ? `?short=${shortId}` : ""), {
      method: inIt ? "DELETE" : "POST",
      headers: { "Content-Type": "application/json" },
      body: inIt ? undefined : JSON.stringify({ shortId }),
    });
  };

  const createAndAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setName("");
    const res = await fetch("/api/shorts/playlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: n }),
    });
    if (res.ok) {
      const { playlist } = await res.json();
      await fetch(`/api/shorts/playlists/${playlist.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shortId }),
      });
      refresh();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onClose}>
      <div
        className="flex max-h-[70%] flex-col rounded-t-2xl bg-neutral-900 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <span className="font-semibold">Save to playlist</span>
          <button onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <form onSubmit={createAndAdd} className="flex gap-2 border-b border-white/10 p-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New playlist…"
            className="flex-1 rounded-full bg-white/10 px-4 py-2 text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
          />
          <button type="submit" className="rounded-full bg-rose-500 p-2 transition active:scale-90">
            <Plus size={18} />
          </button>
        </form>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {loading && <p className="px-2 text-sm text-white/50">Loading…</p>}
          {!loading && playlists.length === 0 && (
            <p className="px-2 text-sm text-white/50">
              No playlists yet — create one above.
            </p>
          )}
          {playlists.map((p) => (
            <button
              key={p.id}
              onClick={() => toggle(p)}
              className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left hover:bg-white/5"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{p.name}</span>
                <span className="text-xs text-white/50">{p.item_count} clips</span>
              </span>
              <Bookmark
                size={20}
                className={cn(p.contains ? "fill-rose-500 text-rose-500" : "text-white/40")}
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
