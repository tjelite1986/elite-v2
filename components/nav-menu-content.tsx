"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Bell,
  BookOpen,
  CalendarHeart,
  Flame,
  House,
  Images,
  Loader2,
  LogOut,
  MessageCircle,
  Newspaper,
  Play,
  Search,
  Settings,
  Sparkles,
  Store,
  Users,
} from "lucide-react";
import PostAvatar from "@/components/post-avatar";

// ---------------------------------------------------------------------------
// Shared app menu — profile header plus quick links to the rest of the app,
// in the style of Messenger's Menu page. Rendered both by the messenger
// shell's Menu tab and by the global bottom-nav menu sheet, so the two menus
// never diverge.
// ---------------------------------------------------------------------------

export function MenuRow({
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

export default function NavMenuContent({
  myUsername,
  myEmail,
  beforeSections,
}: {
  myUsername: string;
  myEmail: string;
  beforeSections?: React.ReactNode;
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
    <>
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

      {beforeSections && (
        <div className="mt-1 border-t border-white/10 pt-1">
          {beforeSections}
        </div>
      )}

      <div className="mt-1 border-t border-white/10 pt-1">
        <MenuRow href="/" icon={<House size={18} />} label="Home" />
        <MenuRow
          href="/messages"
          icon={<MessageCircle size={18} />}
          label="Messages"
        />
        <MenuRow
          href="/messages?tab=notifications"
          icon={<Bell size={18} />}
          label="Notifications"
        />
        <MenuRow href="/people" icon={<Users size={18} />} label="People" />
        <MenuRow href="/posts" icon={<Newspaper size={18} />} label="Posts" />
        <MenuRow href="/gallery" icon={<Images size={18} />} label="Gallery" />
        <MenuRow href="/shorts" icon={<Play size={18} />} label="Shorts" />
        <MenuRow href="/shorts18" icon={<Flame size={18} />} label="18+" />
        <MenuRow href="/books" icon={<BookOpen size={18} />} label="Books" />
        <MenuRow href="/store" icon={<Store size={18} />} label="App Store" />
      </div>

      <div className="mt-1 border-t border-white/10 pt-1">
        <MenuRow
          href="/search"
          icon={<Search size={18} />}
          label="Search"
          sub="Posts, messages, photos, shorts, books"
        />
        <MenuRow
          href="/memories"
          icon={<CalendarHeart size={18} />}
          label="On this day"
          sub="Posts, photos and messages from earlier years"
        />
        <MenuRow
          href="/ask"
          icon={<Sparkles size={18} />}
          label="Ask AI"
          sub="Search and chat with AI"
        />
      </div>

      <div className="mt-1 border-t border-white/10 pt-1">
        <MenuRow href="/settings" icon={<Settings size={18} />} label="Settings" />
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
    </>
  );
}
