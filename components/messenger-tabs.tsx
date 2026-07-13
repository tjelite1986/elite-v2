"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  Check,
  Images,
  Loader2,
  LogOut,
  MessageCircleQuestion,
  Newspaper,
  Play,
  Plus,
  Settings,
  ShieldCheck,
  Sparkles,
  Store,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useBackDismiss } from "@/lib/use-back-dismiss";
import PostAvatar from "@/components/post-avatar";
import StoryViewer from "@/components/story-viewer";
import type { StoryGroup } from "@/lib/stories";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function timeAgo(value: string): string {
  const d = new Date(value.replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return "";
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / (7 * 86400))}w`;
}

function initials(name: string): string {
  const local = name.split("@")[0] || name;
  const letters = local.replace(/[^a-zA-Z0-9]/g, "");
  return (letters.slice(0, 2) || "?").toUpperCase();
}

// ---------------------------------------------------------------------------
// Stories tab — Messenger-style grid of story cards. Reuses the 24h stories
// backend from the posts module (/api/posts/stories) and the fullscreen
// StoryViewer. First card adds to your story; your active story (if any) and
// followed users' stories follow as image cards.
// ---------------------------------------------------------------------------

export function StoriesTab({ myUsername }: { myUsername: string }) {
  const [groups, setGroups] = useState<StoryGroup[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [viewerAt, setViewerAt] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useBackDismiss(viewerAt !== null, () => setViewerAt(null));

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/posts/stories");
      if (res.ok) setGroups((await res.json()).groups || []);
    } catch {
      /* noop */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const upload = async (file: File) => {
    setUploading(true);
    const fd = new FormData();
    fd.set("file", file);
    try {
      await fetch("/api/posts/stories", { method: "POST", body: fd });
      await load();
    } finally {
      setUploading(false);
    }
  };

  const mine = groups.find((g) => g.isSelf);
  const ordered = mine ? [mine, ...groups.filter((g) => !g.isSelf)] : groups;

  return (
    <div className="h-full overflow-y-auto">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
      />
      <div className="px-4 pt-4 text-2xl font-bold">Stories</div>
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5">
        {/* Add to story */}
        <button
          onClick={() => fileRef.current?.click()}
          className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-white/5 text-left transition hover:bg-white/10"
        >
          {!avatarFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/profiles/${encodeURIComponent(myUsername)}/avatar?c=2`}
              alt=""
              className="h-full w-full object-cover"
              onError={() => setAvatarFailed(true)}
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-blue-500/40 to-purple-600/40 text-3xl font-bold text-white/70">
              {initials(myUsername)}
            </span>
          )}
          <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-8 text-sm font-semibold">
            Add to story
          </span>
          <span className="absolute left-3 top-3 flex size-9 items-center justify-center rounded-full bg-white text-black shadow">
            {uploading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Plus size={18} />
            )}
          </span>
        </button>

        {/* Story cards */}
        {ordered.map((g) => (
          <button
            key={g.userId}
            onClick={() => setViewerAt(groups.indexOf(g))}
            className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-white/5 text-left"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/posts/stories/${g.stories[0]?.id}/media`}
              alt=""
              className="h-full w-full object-cover transition group-hover:scale-105"
            />
            <span
              className={cn(
                "absolute left-2.5 top-2.5 block rounded-full p-[2px]",
                g.allViewed
                  ? "bg-white/40"
                  : "bg-gradient-to-tr from-rose-500 to-amber-400"
              )}
            >
              <span className="block rounded-full bg-black p-[2px]">
                <PostAvatar username={g.username} size={34} />
              </span>
            </span>
            <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent p-3 pt-8 text-sm font-semibold">
              {g.isSelf ? "Your story" : g.username}
            </span>
          </button>
        ))}
      </div>
      {loaded && groups.length === 0 && (
        <div className="px-4 pb-6 text-sm text-white/40">
          No active stories from people you follow. Stories disappear after 24
          hours.
        </div>
      )}

      {viewerAt !== null && groups[viewerAt] && (
        <StoryViewer
          groups={groups}
          startGroup={viewerAt}
          onClose={() => {
            setViewerAt(null);
            load();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notifications tab — unread activity (messages, likes/comments/follows,
// invite requests for admins) from /api/notifications, with mark-all-read.
// ---------------------------------------------------------------------------

interface NotificationItem {
  id: string;
  user: string;
  action: string;
  timestamp: string;
  href: string;
}

export function NotificationsTab({
  onCountChange,
}: {
  onCountChange?: (n: number) => void;
}) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [marking, setMarking] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (res.ok) {
        const data = await res.json();
        setItems(data.notifications || []);
        onCountChange?.(data.unreadCount ?? 0);
      }
    } catch {
      /* noop */
    } finally {
      setLoaded(true);
    }
  }, [onCountChange]);

  useEffect(() => {
    load();
  }, [load]);

  const markAllRead = async () => {
    setMarking(true);
    try {
      await fetch("/api/notifications", { method: "POST" });
      await load();
    } finally {
      setMarking(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex items-center justify-between px-4 pt-4">
        <span className="text-2xl font-bold">Notifications</span>
        {items.length > 0 && (
          <button
            onClick={markAllRead}
            disabled={marking}
            className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium transition hover:bg-white/15 disabled:opacity-50"
          >
            {marking ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Check size={13} />
            )}
            Mark all read
          </button>
        )}
      </div>

      <div className="mt-2 pb-4">
        {items.map((n) => (
          <Link
            key={n.id}
            href={n.href}
            className="flex items-center gap-3 px-4 py-3 transition hover:bg-white/5"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-sm font-semibold">
              {initials(n.user)}
            </span>
            <span className="min-w-0 flex-1 text-sm">
              <span data-pii className="font-semibold">
                {n.user.split("@")[0]}
              </span>{" "}
              <span className="text-white/70">{n.action}</span>
              <span className="ml-1.5 text-xs text-white/40">
                · {timeAgo(n.timestamp)}
              </span>
            </span>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-blue-500" />
          </Link>
        ))}
        {loaded && items.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-white/40">
            You&apos;re all caught up.
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Menu tab — profile header plus quick links to the rest of the app, in the
// style of Messenger's Menu page.
// ---------------------------------------------------------------------------

function MenuRow({
  href,
  icon,
  label,
  sub,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  sub?: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-4 px-4 py-3 transition hover:bg-white/5"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/80">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-medium">{label}</span>
        {sub && <span className="block text-xs text-white/40">{sub}</span>}
      </span>
    </Link>
  );
}

export function MenuTab({
  myUsername,
  myEmail,
  isAdmin,
}: {
  myUsername: string;
  myEmail: string;
  isAdmin: boolean;
}) {
  const [loggingOut, setLoggingOut] = useState(false);

  const logout = async () => {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/login";
    } catch {
      setLoggingOut(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto pb-4">
      <div className="px-4 pt-4 text-2xl font-bold">Menu</div>

      <Link
        href={`/people/${encodeURIComponent(myUsername)}`}
        className="mt-2 flex items-center gap-3 px-4 py-3 transition hover:bg-white/5"
      >
        <PostAvatar username={myUsername} size={44} />
        <span className="min-w-0">
          <span data-pii className="block truncate font-semibold">
            {myUsername}
          </span>
          <span data-pii className="block truncate text-xs text-white/40">
            View profile · {myEmail}
          </span>
        </span>
      </Link>

      <div className="mt-1 border-t border-white/10 pt-1">
        <MenuRow href="/settings" icon={<Settings size={18} />} label="Settings" />
        {isAdmin && (
          <MenuRow href="/admin" icon={<ShieldCheck size={18} />} label="Admin" />
        )}
      </div>

      <div className="mt-1 border-t border-white/10 pt-1">
        <MenuRow href="/people" icon={<Users size={18} />} label="People" />
        <MenuRow href="/posts" icon={<Newspaper size={18} />} label="Posts" />
        <MenuRow href="/gallery" icon={<Images size={18} />} label="Gallery" />
        <MenuRow href="/shorts" icon={<Play size={18} />} label="Shorts" />
        <MenuRow href="/books" icon={<BookOpen size={18} />} label="Books" />
        <MenuRow href="/store" icon={<Store size={18} />} label="App Store" />
      </div>

      <div className="mt-1 border-t border-white/10 pt-1">
        <MenuRow
          href="/ask"
          icon={<Sparkles size={18} />}
          label="Ask AI"
          sub="Search and chat with AI"
        />
      </div>

      <div className="mt-1 border-t border-white/10 pt-1">
        <button
          onClick={logout}
          disabled={loggingOut}
          className="flex w-full items-center gap-4 px-4 py-3 text-left text-red-400 transition hover:bg-white/5 disabled:opacity-50"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-red-500/10">
            {loggingOut ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <LogOut size={18} />
            )}
          </span>
          <span className="text-[15px] font-medium">Log out</span>
        </button>
      </div>

      <div className="mt-4 flex items-center gap-2 px-4 text-xs text-white/30">
        <MessageCircleQuestion size={14} />
        Messages, stories and notifications live here — everything else is in
        the menu above.
      </div>
    </div>
  );
}
