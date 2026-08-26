"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bell,
  Camera,
  ChevronRight,
  Download,
  Film,
  Flame,
  Github,
  Globe,
  House,
  Images,
  Loader2,
  Lock,
  LogOut,
  Mail,
  MessageCircle,
  Music4,
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
// Shared app menu — designed in Layout Studio (docs/layout-studio/
// elitev3-copy.json, "Menu" screen): compact profile header with @handle and
// an Edit button, a search field, flat chevron rows in divided groups, the
// screenshot toggle + settings + log out, and a social-links footer. Rendered
// both by the messenger shell's Menu tab and by the global bottom-nav menu
// sheet, so the two menus never diverge.
// ---------------------------------------------------------------------------

export function MenuRow({
  href,
  icon,
  label,
  sub,
  hard,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  sub?: string;
  /**
   * Leave the app. Set for a path on this origin that another app answers —
   * the router would otherwise try to resolve it as one of our own routes.
   */
  hard?: boolean;
}) {
  const Tag = hard ? "a" : Link;
  return (
    <Tag
      href={href}
      className="flex items-center gap-3.5 px-4 py-2.5 transition hover:bg-white/5"
    >
      <span className="shrink-0 text-white/60">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{label}</span>
        {sub && <span className="block text-xs text-white/40">{sub}</span>}
      </span>
      <ChevronRight size={16} className="shrink-0 text-white/25" />
    </Tag>
  );
}

const SOCIALS = [
  { href: "https://github.com/tjelite1986", label: "GitHub", icon: Github },
  { href: "https://mecloud.win", label: "Website", icon: Globe },
  { href: "mailto:tjelite1986@gmail.com", label: "Email", icon: Mail },
];

export default function NavMenuContent({
  myUsername,
  myEmail,
  myDisplayName,
  beforeSections,
  isAdmin = false,
  showAppstore = true,
}: {
  myUsername: string;
  myEmail: string;
  myDisplayName?: string | null;
  beforeSections?: React.ReactNode;
  // Grab is an admin tool, so its row only exists for admins.
  isAdmin?: boolean;
  // False when the account may not reach the store, or has switched the row
  // off in Settings. Default true: a caller that has not been taught about it
  // shows the store, which is how it behaved before there was a switch.
  showAppstore?: boolean;
}) {
  // The sketch's header shows @handle + "View profile" without the email, but
  // both callers still pass it — keep the prop so the API stays stable.
  void myEmail;

  const [loggingOut, setLoggingOut] = useState(false);

  // Visibility of the floating screenshot/privacy button. Persisted per device
  // (localStorage); PrivacyControls listens for the event and hides instantly.
  const [fabHidden, setFabHidden] = useState(false);
  useEffect(() => {
    setFabHidden(localStorage.getItem("privacy_fab_hidden") === "1");
  }, []);
  const toggleFab = () => {
    setFabHidden((prev) => {
      const next = !prev;
      localStorage.setItem("privacy_fab_hidden", next ? "1" : "0");
      window.dispatchEvent(new Event("privacy-fab-visibility"));
      return next;
    });
  };

  const logout = async () => {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/login";
    } catch {
      setLoggingOut(false);
    }
  };

  const profileHref = `/people/${encodeURIComponent(myUsername)}`;

  return (
    <>
      {/* Profile header: avatar with accent ring, name, @handle, edit button.
          Avatar/name and the edit button are separate links — nesting them
          would be invalid markup. */}
      <div className="mt-2 flex items-center gap-3 px-4 py-3">
        <Link href={profileHref} className="flex min-w-0 flex-1 items-center gap-3">
          <span className="shrink-0 rounded-full ring-2 ring-blue-400 ring-offset-2 ring-offset-neutral-900">
            <PostAvatar username={myUsername} size={44} />
          </span>
          <span className="min-w-0">
            <span data-pii className="block truncate font-semibold">
              {myDisplayName || myUsername}
            </span>
            <span data-pii className="block truncate text-xs text-white/40">
              @{myUsername}
            </span>
            <span className="block truncate text-xs text-white/40">
              View profile
            </span>
          </span>
        </Link>
        <Link
          href={`${profileHref}/edit`}
          className="shrink-0 rounded-full border border-white/15 px-3 py-1.5 text-xs font-medium transition hover:bg-white/10"
        >
          Edit profile
        </Link>
      </div>

      {/* Tap-to-search field, matching the sketch's search bar. */}
      <div className="border-t border-white/10 px-4 pb-1 pt-3">
        <Link
          href="/search"
          className="flex items-center gap-2.5 rounded-full bg-white/10 px-3.5 py-2 text-sm text-white/50 transition hover:bg-white/15"
        >
          <Search size={15} />
          Search
        </Link>
      </div>

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
        <MenuRow href="/people" icon={<Users size={18} />} label="Profiles" />
        <MenuRow
          href="/messages?tab=notifications"
          icon={<Bell size={18} />}
          label="Notifications"
        />
      </div>

      <div className="mt-1 border-t border-white/10 pt-1">
        <MenuRow href="/gallery" icon={<Images size={18} />} label="Gallery" />
        <MenuRow href="/settings#adult" icon={<Lock size={18} />} label="Privacy" />
      </div>

      <div className="mt-1 border-t border-white/10 pt-1">
        <MenuRow href="/posts" icon={<Newspaper size={18} />} label="InstaElite" />
        <MenuRow href="/shorts" icon={<Play size={18} />} label="Shorts" />
        <MenuRow href="/shorts18" icon={<Flame size={18} />} label="Shorts 18+" />
        <MenuRow
          href="/videos"
          icon={<Film size={18} />}
          label="Videos"
          sub="Long-form video library"
        />
        <MenuRow href="/videos18" icon={<Film size={18} />} label="Videos 18+" />
        <MenuRow
          href="/music"
          icon={<Music4 size={18} />}
          label="Music"
          sub="Navidrome library"
        />
      </div>

      <div className="mt-1 border-t border-white/10 pt-1">
        {/* Its own app since 2026-08-26, but not its own address: /store on
            this host is routed straight to it, so the store is a section of
            this site and the session cookie is first-party there. It is not
            one of our routes, though — hence a real navigation. */}
        {showAppstore && (
          <MenuRow
            href="/store"
            icon={<Store size={18} />}
            label="App Store"
            sub="APK library"
            hard
          />
        )}
        {/* Grabbing belongs to the whole app, not to one section: the tool
            picks the channel (Shorts / Shorts 18+) itself. */}
        {isAdmin && (
          <MenuRow href="/shorts/grab" icon={<Download size={18} />} label="Grab from web" />
        )}
      </div>

      <div className="mt-1 border-t border-white/10 pt-1">
        <MenuRow href="/ask" icon={<Sparkles size={18} />} label="Ask AI" />
      </div>

      <div className="mt-1 border-t border-white/10 pt-1">
        <button
          onClick={toggleFab}
          role="switch"
          aria-checked={!fabHidden}
          className="flex w-full items-center gap-3.5 px-4 py-2.5 text-left transition hover:bg-white/5"
        >
          <span className="shrink-0 text-white/60">
            <Camera size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium">Screenshot button</span>
            <span className="block text-xs text-white/40">
              Show the floating privacy/screenshot button
            </span>
          </span>
          <span
            className={`relative h-6 w-11 shrink-0 rounded-full transition ${
              fabHidden ? "bg-white/20" : "bg-blue-600"
            }`}
          >
            <span
              className={`absolute top-1 size-4 rounded-full bg-white transition-all ${
                fabHidden ? "left-1" : "left-6"
              }`}
            />
          </span>
        </button>
        <MenuRow href="/settings" icon={<Settings size={18} />} label="Settings" />
        <button
          onClick={logout}
          disabled={loggingOut}
          className="flex w-full items-center gap-3.5 px-4 py-2.5 text-left text-red-400 transition hover:bg-white/5 disabled:opacity-50"
        >
          <span className="shrink-0">
            {loggingOut ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <LogOut size={18} />
            )}
          </span>
          <span className="text-[15px] font-medium">Log out</span>
        </button>
      </div>

      {/* Social links footer — round icon buttons, centred. */}
      <div className="mt-2 border-t border-white/10 px-4 pb-2 pt-4">
        <div className="flex justify-center gap-3">
          {SOCIALS.map(({ href, label, icon: Icon }) => (
            <a
              key={href}
              href={href}
              target={href.startsWith("http") ? "_blank" : undefined}
              rel="noreferrer"
              title={label}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white/70 transition hover:bg-white/20 hover:text-white"
            >
              <Icon size={18} />
            </a>
          ))}
        </div>
      </div>
    </>
  );
}
