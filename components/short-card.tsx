"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
  FastForward,
  Rewind,
  Globe,
  Lock,
  ArrowRightLeft,
  Clapperboard,
  Trash2,
  MoreVertical,
  ListVideo,
  Download,
  Pencil,
  Hash,
  Maximize,
  Link2,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useBackDismiss } from "@/lib/use-back-dismiss";
import { SHORT_CATEGORIES, CATEGORY_LABELS } from "@/lib/shorts-categories";
import { splitCaption, buildCaption } from "@/lib/shorts-caption";
import PostAvatar from "@/components/post-avatar";
import LinkifyText from "@/components/linkify-text";

// Player interaction tuning.
const SEEK_SECONDS = 10; // double-tap skip distance
const SEEK_ZONE = 0.35; // outer-third tap = seek, middle = like
const DOUBLE_TAP_MS = 220; // window to detect a second tap
const LONG_PRESS_MS = 550; // hold to toggle the clean view
const BURST_MS = 700; // like-heart animation
const SEEK_HINT_MS = 600; // seek indicator linger

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// Seconds → "m:ss".
function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

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
  source: string;
  source_id: string | null;
  like_count: number;
  comment_count: number;
  viewer_liked: boolean;
  viewer_saved: boolean;
  has_poster: boolean;
  poster_v: string | null;
  is_private: boolean;
}

interface Comment {
  id: number;
  body: string;
  author_name: string | null;
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

const TITLE_CLAMP = 40; // chars before the title gets a "more" expander

function linkFor(url: string): { url: string; label: string } | null {
  try {
    return { url, label: new URL(url).hostname.replace(/^www\./, "") };
  } catch {
    return null;
  }
}

// Best-effort link back to the clip's original source. A full URL is used
// as-is; a long numeric id on a creator clip is a TikTok video id; an
// 11-char id looks like YouTube. Anything else gets no link.
function sourceLink(short: FeedShort): { url: string; label: string } | null {
  const sid = short.source_id;
  if (!sid) return null;
  if (/^https?:\/\//i.test(sid)) {
    return linkFor(sid);
  }
  if (/^\d{15,}$/.test(sid) && short.profile_name) {
    return {
      url: `https://www.tiktok.com/@${short.profile_name}/video/${sid}`,
      label: "tiktok.com",
    };
  }
  if (/^[\w-]{11}$/.test(sid)) {
    return { url: `https://www.youtube.com/watch?v=${sid}`, label: "youtube.com" };
  }
  return null;
}

// Attribution for a clip: the creator profile when the clip belongs to one
// (keeps the label in sync with the /people link), otherwise the uploader.
function authorLabel(short: FeedShort): string {
  if (short.profile_id && short.profile_name) return short.profile_name;
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
  viewerId,
  categoryEditable = false,
  isAdmin = false,
  chromeHidden = false,
  onToggleChrome,
  onToggleFullscreen,
  autoAdvance = false,
  onEnded,
  onRemoved,
}: {
  short: FeedShort;
  active: boolean;
  muted: boolean;
  onToggleMuted: () => void;
  // The current user's id, to decide if they own this clip (visibility toggle).
  viewerId: number;
  // Admins in the 18+ section get a category button to sort the clip in place.
  categoryEditable?: boolean;
  // Admins get a "Cover" button to set the thumbnail from the current frame.
  isAdmin?: boolean;
  // Clean view: hide all overlay UI. Long-press the clip to toggle it back.
  chromeHidden?: boolean;
  onToggleChrome?: () => void;
  // Feed-level fullscreen toggle, exposed in the 3-dot menu too.
  onToggleFullscreen?: () => void;
  // Auto-scroll: don't loop; fire onEnded when the clip finishes so the feed
  // can advance to the next one.
  autoAdvance?: boolean;
  onEnded?: () => void;
  // Called after the clip left this feed (moved to the other channel, or
  // deleted) so the parent can drop the card and snap to the next clip.
  onRemoved?: (id: number) => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  // Double-tap seek direction (+1 forward / -1 back), shown briefly then cleared.
  const [seekHint, setSeekHint] = useState<1 | -1 | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
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
  const [showGenre, setShowGenre] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  // Device Back closes an open bottom sheet instead of leaving the feed.
  useBackDismiss(showComments, () => setShowComments(false));
  useBackDismiss(showShare, () => setShowShare(false));
  useBackDismiss(showSave, () => setShowSave(false));
  useBackDismiss(showGenre, () => setShowGenre(false));
  useBackDismiss(showDelete, () => setShowDelete(false));
  useBackDismiss(showMore, () => setShowMore(false));
  useBackDismiss(showEdit, () => setShowEdit(false));
  const [category, setCategory] = useState(short.category);
  const [coverMsg, setCoverMsg] = useState<string | null>(null);
  const [caption, setCaption] = useState(short.caption);
  const [isPrivate, setIsPrivate] = useState(short.is_private);
  // Overlay expansion for a long title / many tag chips.
  const [titleExpanded, setTitleExpanded] = useState(false);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const { title, tags, source } = splitCaption(caption);
  const titleLong = title.length > TITLE_CLAMP;
  const srcLink = (source && linkFor(source)) || sourceLink(short);
  // The uploader of a clip (and admins) can flip its public/private visibility.
  const isOwner = short.uploader_id != null && short.uploader_id === viewerId;

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
    }, LONG_PRESS_MS);
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

  // 18+ viewer preference (3-dot menu): which genre the FEED shows — the same
  // `cat` filter the chips drive, so both stay in sync via the URL.
  const activeFeedGenre = searchParams.get("cat") || "all";
  const showOnlyGenre = (cat: string) => {
    if (cat === activeFeedGenre) {
      setShowMore(false);
      return;
    }
    // Do NOT close the sheet first: its useBackDismiss cleanup calls
    // history.back(), which races the push and swallows the ?cat URL. The
    // navigation remounts the feed (the page keys on the filter), unmounting
    // the sheet, and the hook's navigated-away guard skips the back() then.
    router.push(cat === "all" ? "/shorts18" : `/shorts18?cat=${cat}`);
  };

  // 18+ admin: set the clip's genre from the side dropdown (optimistic).
  const setGenre = async (next: string) => {
    setShowGenre(false);
    if (busyAction || next === category) return;
    const prev = category;
    setCategory(next);
    try {
      const res = await fetch(`/api/shorts/${short.id}/category`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: next }),
      });
      if (!res.ok) setCategory(prev);
    } catch {
      setCategory(prev);
    }
  };

  // Owner/admin: flip this clip between public and private.
  const toggleVisibility = async () => {
    const next = !isPrivate;
    setIsPrivate(next); // optimistic
    try {
      const res = await fetch(`/api/shorts/${short.id}/visibility`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPrivate: next }),
      });
      if (!res.ok) setIsPrivate(!next); // revert on failure
    } catch {
      setIsPrivate(!next);
    }
  };

  // Owner/admin: move the clip to the other channel. One tap — the clip is
  // re-homed like an import into the target channel (files + creator profile)
  // and leaves this feed. Moving back is one tap from the other side.
  const otherChannel = short.channel === "18plus" ? "main" : "18plus";
  const moveChannel = async () => {
    if (busyAction) return;
    setBusyAction(true);
    setCoverMsg(`Moving to ${otherChannel === "18plus" ? "18+" : "Shorts"}…`);
    try {
      const res = await fetch(`/api/shorts/${short.id}/channel`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: otherChannel }),
      });
      if (res.ok) {
        setCoverMsg(null);
        onRemoved?.(short.id);
      } else {
        const d = await res.json().catch(() => ({}));
        setCoverMsg(d.error || "Move failed");
        setTimeout(() => setCoverMsg(null), 2500);
      }
    } catch {
      setCoverMsg("Move failed");
      setTimeout(() => setCoverMsg(null), 2500);
    }
    setBusyAction(false);
  };

  // Owner/admin: move the clip out of shorts into the posts Videos tab. The
  // short is retired once the video post exists, so the card leaves this feed.
  const moveToVideos = async () => {
    if (busyAction) return;
    setBusyAction(true);
    setCoverMsg("Moving to Videos…");
    try {
      const res = await fetch(`/api/shorts/${short.id}/to-post`, { method: "POST" });
      if (res.ok) {
        setCoverMsg(null);
        onRemoved?.(short.id);
      } else {
        const d = await res.json().catch(() => ({}));
        setCoverMsg(d.error || "Move failed");
        setTimeout(() => setCoverMsg(null), 2500);
      }
    } catch {
      setCoverMsg("Move failed");
      setTimeout(() => setCoverMsg(null), 2500);
    }
    setBusyAction(false);
  };

  // Owner/admin: delete the clip (confirmed in a sheet — destructive).
  const deleteClip = async () => {
    if (busyAction) return;
    setBusyAction(true);
    try {
      const res = await fetch(`/api/shorts/${short.id}`, { method: "DELETE" });
      if (res.ok) {
        setShowDelete(false);
        onRemoved?.(short.id);
      } else {
        const d = await res.json().catch(() => ({}));
        setCoverMsg(d.error || "Delete failed");
        setTimeout(() => setCoverMsg(null), 2500);
        setShowDelete(false);
      }
    } catch {
      setCoverMsg("Delete failed");
      setTimeout(() => setCoverMsg(null), 2500);
      setShowDelete(false);
    }
    setBusyAction(false);
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
    setTimeout(() => setBurst(false), BURST_MS);
  };

  // Jump the playhead by a signed number of seconds, clamped, with a brief
  // directional on-screen hint.
  const seek = (deltaSeconds: number) => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    v.currentTime = clamp(v.currentTime + deltaSeconds, 0, v.duration);
    setProgress((v.currentTime / v.duration) * 100);
    setSeekHint(deltaSeconds > 0 ? 1 : -1);
    setTimeout(() => setSeekHint(null), SEEK_HINT_MS);
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

  return (
    <section className="relative flex h-full w-full snap-start snap-always items-center justify-center bg-black">
      {/* Video */}
      <video
        ref={videoRef}
        src={`/api/shorts/${short.id}/video`}
        poster={short.has_poster ? `/api/shorts/${short.id}/poster?v=${short.poster_v ?? "2"}` : undefined}
        className="h-full w-full object-contain"
        loop={!autoAdvance}
        onEnded={() => autoAdvance && onEnded?.()}
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

      {/* Cover-set feedback */}
      {coverMsg && (
        <div className="pointer-events-none absolute left-1/2 top-20 z-10 -translate-x-1/2 rounded-full bg-black/75 px-4 py-1.5 text-sm font-medium text-white">
          {coverMsg}
        </div>
      )}

      {/* Thumbnail button, up by the view-control cluster: pause on the frame
          you want and tap to make it the clip's poster (admin). Sits to the
          LEFT of the feed's chevron (right-2), clear of its expansion. */}
      {!chromeHidden && isAdmin && (
        <button
          onClick={setCover}
          title="Thumbnail — use current frame"
          aria-label="Set thumbnail from current frame"
          className="absolute right-12 top-2 z-10 rounded-full bg-black/50 p-2 text-white ring-1 ring-white/10 backdrop-blur transition hover:bg-black/70"
        >
          <ImageIcon size={18} />
        </button>
      )}

      {/* Genre picker (18+ admin): a pill next to the Thumbnail button with a
          dropdown — sorts the clip into its sexuality-preference bucket in one
          tap. "Genre", not "category": categories are reserved for tag-like
          things. */}
      {!chromeHidden && categoryEditable && (
        <div className="absolute left-2 top-2 z-10">
          <button
            onClick={() => setShowGenre((v) => !v)}
            className="flex h-[34px] items-center gap-1.5 rounded-full bg-black/50 px-3 text-xs font-medium text-white ring-1 ring-white/10 backdrop-blur transition hover:bg-black/70"
          >
            <Tag size={13} />
            {CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS] ?? "Genre"}
            <ChevronDown
              size={13}
              className={cn("transition-transform", showGenre && "rotate-180")}
            />
          </button>
          {showGenre && (
            <div className="absolute left-0 top-full mt-1.5 max-h-72 w-44 overflow-y-auto rounded-xl bg-neutral-900/95 py-1 ring-1 ring-white/15 backdrop-blur">
              {SHORT_CATEGORIES.map((c) => (
                <button
                  key={c}
                  onClick={() => setGenre(c)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-xs transition hover:bg-white/10"
                >
                  <span className={cn(category === c && "font-semibold")}>
                    {CATEGORY_LABELS[c]}
                  </span>
                  {category === c && <Check size={14} className="text-rose-500" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Private badge (only the owner/admin can see a private clip at all).
          Sits below the genre pill's top-left slot. */}
      {!chromeHidden && isPrivate && (isOwner || isAdmin) && (
        <div className="pointer-events-none absolute left-2 top-12 z-10 flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-xs font-medium text-amber-300 backdrop-blur-sm">
          <Lock size={12} /> Private
        </div>
      )}

      {/* Double-tap like burst */}
      {burst && (
        <Heart
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 animate-ping fill-white text-white"
          size={96}
        />
      )}

      {/* Double-tap seek hint — on the side that was tapped */}
      {seekHint && (
        <div
          className={cn(
            "pointer-events-none absolute top-1/2 flex -translate-y-1/2 flex-col items-center gap-1 rounded-2xl bg-black/55 px-5 py-3 text-white backdrop-blur-sm",
            seekHint > 0 ? "right-[12%]" : "left-[12%]"
          )}
        >
          {seekHint > 0 ? <FastForward size={28} className="fill-white" /> : <Rewind size={28} className="fill-white" />}
          <span className="text-sm font-semibold tabular-nums">
            {seekHint > 0 ? `+${SEEK_SECONDS}` : `-${SEEK_SECONDS}`}s
          </span>
        </div>
      )}

      {/* Paused indicator */}
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

      {/* Bottom scrim so the caption + timeline stay legible over bright video */}
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
          {/* Time readout while scrubbing */}
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
            <div
              className="h-full rounded-full bg-white"
              style={{ width: `${progress}%` }}
            />
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
            <ListVideo
              size={22}
              className={cn(saved && "text-yellow-400")}
            />
          }
          label="Playlists"
          onClick={() => setShowSave(true)}
        />
        <RailButton
          icon={<Share2 size={22} />}
          label="Share"
          onClick={() => setShowShare(true)}
        />
        <RailLink
          icon={<Download size={22} />}
          label="Download"
          href={`/api/shorts/${short.id}/video?download=1`}
        />
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

      {/* Author / title / source / tags — FikFap-style stacked overlay:
          avatar + plain profile name (no @), the title (expandable), the
          original-source link, then tag chips (expandable). */}
      {!chromeHidden && (
        <div
          className="absolute bottom-6 left-3 right-20 text-white"
          onClick={(e) => e.stopPropagation()}
        >
          {short.profile_id && short.profile_name ? (
            <Link
              href={`/people/${personHandle(short.profile_name)}`}
              className="flex w-fit items-center gap-2.5 transition active:scale-95"
            >
              <PostAvatar username={personHandle(short.profile_name)} size={40} />
              <span className="text-[15px] font-semibold drop-shadow">
                {authorLabel(short)}
              </span>
            </Link>
          ) : (
            <div className="flex w-fit items-center gap-2.5">
              <PostAvatar username={displayName(short.uploader_email)} size={40} />
              <span className="text-[15px] font-semibold drop-shadow">
                {authorLabel(short)}
              </span>
            </div>
          )}
          {title && (
            <p
              onClick={() => titleLong && setTitleExpanded((v) => !v)}
              className={cn(
                "mt-1.5 text-sm drop-shadow",
                titleExpanded
                  ? "max-h-[35vh] overflow-y-auto whitespace-pre-wrap"
                  : "line-clamp-1",
                titleLong && "cursor-pointer"
              )}
            >
              <LinkifyText text={title} />
              {titleLong && (
                <span className="ml-1 font-medium text-white/60">
                  {titleExpanded ? " less" : "… more"}
                </span>
              )}
            </p>
          )}
          {srcLink && (
            <a
              href={srcLink.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 flex w-fit max-w-full items-center gap-1 truncate text-xs text-sky-300 drop-shadow transition active:scale-95"
            >
              <Link2 size={12} className="shrink-0" /> {srcLink.label}
            </a>
          )}
          {tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {(tagsExpanded ? tags : tags.slice(0, 3)).map((t) => (
                <Link
                  key={t}
                  href={`${short.channel === "18plus" ? "/shorts18" : "/shorts"}/tag/${encodeURIComponent(t.slice(1))}`}
                  className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium backdrop-blur transition active:scale-95"
                >
                  {t}
                </Link>
              ))}
              {tags.length > 3 && (
                <button
                  onClick={() => setTagsExpanded((v) => !v)}
                  className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium text-white/70 backdrop-blur transition active:scale-95"
                >
                  {tagsExpanded ? "less" : `+${tags.length - 3} more`}
                </button>
              )}
            </div>
          )}
        </div>
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
            <p className="text-base font-semibold">Delete this clip?</p>
            <p className="mt-1 text-sm text-white/60">
              The video and its file are removed. This can&apos;t be undone.
            </p>
            <div className="mt-4 flex gap-3">
              <button
                onClick={deleteClip}
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
            {short.channel === "18plus" && (
              <>
                <div className="my-1 border-t border-white/10" />
                <p className="px-5 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-white/40">
                  Show in feed
                </p>
                {[
                  { value: "all", label: "All" },
                  ...SHORT_CATEGORIES.map((c) => ({
                    value: c as string,
                    label: CATEGORY_LABELS[c],
                  })),
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => showOnlyGenre(opt.value)}
                    className="flex w-full items-center justify-between px-5 py-2 text-left text-sm transition hover:bg-white/5"
                  >
                    <span
                      className={cn(
                        activeFeedGenre === opt.value
                          ? "font-semibold text-white"
                          : "text-white/70"
                      )}
                    >
                      {opt.label}
                    </span>
                    {activeFeedGenre === opt.value && (
                      <Check size={16} className="text-rose-500" />
                    )}
                  </button>
                ))}
              </>
            )}
            {(isOwner || isAdmin) && (
              <>
                <div className="my-1 border-t border-white/10" />
                <MoreRow
                  icon={
                    isPrivate ? (
                      <Lock size={18} className="text-amber-400" />
                    ) : (
                      <Globe size={18} />
                    )
                  }
                  label={isPrivate ? "Private — make public" : "Public — make private"}
                  onClick={() => {
                    setShowMore(false);
                    toggleVisibility();
                  }}
                />
                <MoreRow
                  icon={<Pencil size={18} />}
                  label="Edit title"
                  onClick={() => {
                    setShowMore(false);
                    setShowEdit(true);
                  }}
                />
                <MoreRow
                  icon={<Hash size={18} />}
                  label="Tags"
                  onClick={() => {
                    setShowMore(false);
                    setShowEdit(true);
                  }}
                />
                {isAdmin && (
                  <MoreRow
                    icon={<Type size={18} />}
                    label="Fetch title from source"
                    onClick={() => {
                      setShowMore(false);
                      fetchTitle();
                    }}
                  />
                )}
                <div className="my-1 border-t border-white/10" />
                <MoreRow
                  icon={<ArrowRightLeft size={18} />}
                  label={otherChannel === "18plus" ? "Move to 18+" : "Move to Shorts"}
                  onClick={() => {
                    setShowMore(false);
                    moveChannel();
                  }}
                />
                <MoreRow
                  icon={<Clapperboard size={18} />}
                  label="Move to Videos (posts)"
                  onClick={() => {
                    setShowMore(false);
                    moveToVideos();
                  }}
                />
                <MoreRow
                  icon={<Trash2 size={18} className="text-red-400" />}
                  label="Delete"
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

      {showEdit && (
        <EditSheet
          shortId={short.id}
          caption={caption}
          onClose={() => setShowEdit(false)}
          onSaved={(c) => {
            setCaption(c);
            setShowEdit(false);
          }}
        />
      )}

      {showComments && (
        <CommentsSheet
          shortId={short.id}
          onClose={() => setShowComments(false)}
          onCountChange={setCommentCount}
        />
      )}
      {showShare && (
        <ShareSheet
          shortId={short.id}
          channel={short.channel}
          onClose={() => setShowShare(false)}
        />
      )}
      {showSave && (
        <SaveSheet
          shortId={short.id}
          onClose={() => setShowSave(false)}
          onSavedChange={setSaved}
        />
      )}
    </section>
  );
}

// Admin category picker for the 18+ feed: tap a bucket to sort the clip in place.

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

// Rail entry that navigates (the Download button) — same look as RailButton.
function RailLink({
  icon,
  label,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className="flex flex-col items-center gap-0.5 transition active:scale-90"
    >
      <span className="drop-shadow-lg">{icon}</span>
      <span className="text-[10px] font-medium leading-tight drop-shadow">
        {label}
      </span>
    </a>
  );
}

// One row in the 3-dot menu sheet.
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

// Edit the clip's title, #tags and source link (all three live in the
// caption: "title\n\n#tag1 …\n\nSource: <url>", the format grabbit imports use).
function EditSheet({
  shortId,
  caption,
  onClose,
  onSaved,
}: {
  shortId: number;
  caption: string | null;
  onClose: () => void;
  onSaved: (caption: string | null) => void;
}) {
  const initial = splitCaption(caption);
  const [title, setTitle] = useState(initial.title);
  const [tags, setTags] = useState(initial.tags.join(" "));
  const [source, setSource] = useState(initial.source ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    // Normalize the tags field: every word becomes a #tag.
    const tagList = tags
      .split(/[\s,]+/)
      .map((t) => t.replace(/^#+/, "").trim())
      .filter(Boolean)
      .map((t) => `#${t}`);
    const src = source.trim();
    if (src && !/^https?:\/\/\S+$/i.test(src)) {
      setError("Source must be a full http(s) URL.");
      setSaving(false);
      return;
    }
    const next = buildCaption({ title, tags: tagList, source: src || null });
    try {
      const res = await fetch(`/api/shorts/${shortId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption: next }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) onSaved(d.caption ?? null);
      else setError(d.error || "Could not save.");
    } catch {
      setError("Could not save.");
    }
    setSaving(false);
  };

  return (
    <div
      className="absolute inset-0 z-20 flex items-end justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl bg-neutral-900 p-5 pb-8 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-3 text-base font-semibold">Edit title, source & tags</p>
        <label className="mb-1 block text-xs text-white/50">Title</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Clip title…"
          className="mb-3 w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
        />
        <label className="mb-1 block text-xs text-white/50">Source URL</label>
        <input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="https://…"
          inputMode="url"
          className="mb-3 w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
        />
        <label className="mb-1 block text-xs text-white/50">
          Tags (space-separated, # optional)
        </label>
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="#dance #funny"
          className="mb-4 w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
        />
        {error && <p className="mb-2 text-sm text-rose-400">{error}</p>}
        <div className="flex gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 rounded-full bg-rose-500 py-2.5 text-sm font-semibold transition active:scale-95 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={onClose}
            className="flex-1 rounded-full bg-white/10 py-2.5 text-sm font-semibold transition active:scale-95"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
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
              <span className="font-semibold">@{c.author_name ?? "Unknown"}</span>{" "}
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
  channel,
  onClose,
}: {
  shortId: number;
  channel: string;
  onClose: () => void;
}) {
  const [users, setUsers] = useState<ChatUser[]>([]);
  const [sentTo, setSentTo] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  // Share outside the app: the system share sheet where available (mobile),
  // otherwise copy the deep link to the clipboard.
  const shareExternal = async () => {
    const url = `${window.location.origin}${
      channel === "18plus" ? "/shorts18" : "/shorts"
    }?focus=${shortId}`;
    if (navigator.share) {
      try {
        await navigator.share({ url });
        return;
      } catch {
        /* dismissed — fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

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
          <span className="font-semibold">Share</span>
          <button onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <button
          onClick={shareExternal}
          className="mx-2 mt-2 flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-white/5"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10">
            <Link2 size={17} />
          </span>
          {copied ? "Link copied!" : "Share outside the app / copy link"}
        </button>
        <div className="mx-4 my-2 border-t border-white/10" />
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
