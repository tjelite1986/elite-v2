"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWs } from "@/components/ws-provider";
import {
  activeNavHref,
  getBottomNavExtras,
  getBottomNavItems,
} from "@/components/bottom-nav-config";
import NavMenuSheet from "@/components/nav-menu-sheet";

// Global Messenger-style bottom nav: three per-section contextual links plus
// a Menu button (same everywhere) opening the shared menu sheet. Wraps the
// page content so it can also own the bottom padding that keeps content from
// hiding under the fixed bar. The Menu button carries the unread-notification
// badge (the old top-nav bell's poll + websocket pattern).
export default function BottomNav({
  username,
  displayName,
  email,
  canActAs,
  isAdmin = false,
  children,
}: {
  username: string;
  displayName?: string | null;
  email: string;
  canActAs: boolean;
  isAdmin?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { subscribe } = useWs();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifCount, setNotifCount] = useState(0);

  // Close the sheet when a menu link navigates away.
  useEffect(() => setMenuOpen(false), [pathname]);

  const loadNotifCount = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (res.ok) setNotifCount((await res.json()).unreadCount ?? 0);
    } catch {
      /* noop */
    }
  }, []);

  // Initial load + light polling to stay in sync (reads clear server-side),
  // plus immediate refresh on pushed notification events.
  useEffect(() => {
    loadNotifCount();
    const t = setInterval(loadNotifCount, 30000);
    return () => clearInterval(t);
  }, [loadNotifCount]);
  useEffect(() => {
    return subscribe((event) => {
      if (event.type === "message" || event.type === "notification" || event.type === "reconnected") {
        loadNotifCount();
      }
    });
  }, [subscribe, loadNotifCount]);

  // /messages has its own bottom tab bar (MessagesShell) sized to the exact
  // viewport — no global bar and no extra padding there.
  const onMessages =
    pathname === "/messages" || pathname.startsWith("/messages/");
  // The shorts root pages and the posts Videos feed are exact-viewport feeds;
  // bottom padding would just add a dead scroll gap under them.
  const fullBleed =
    pathname === "/shorts" ||
    pathname === "/shorts18" ||
    pathname === "/posts/videos";

  const items = getBottomNavItems(pathname, { username });
  const activeHref = activeNavHref(pathname, items);
  const extras = getBottomNavExtras(pathname, { isAdmin });

  return (
    <>
      <div
        className={cn(
          "pt-[env(safe-area-inset-top)]",
          !onMessages &&
            !fullBleed &&
            "pb-[calc(3.5rem+env(safe-area-inset-bottom))]"
        )}
      >
        {children}
      </div>

      {!onMessages && (
        <>
          {/* z-40: below every fullscreen overlay (lightbox/story/gallery are
              z-50+) so they cover the bar; hidden in immersive shorts playback
              via the body.shorts-immersive rule in globals.css. */}
          <nav
            data-immersive-hide
            className="fixed inset-x-0 bottom-0 z-40 flex border-t border-white/10 bg-black/60 pb-[env(safe-area-inset-bottom)] backdrop-blur"
          >
            {items.map(({ label, href, icon: Icon }) => {
              const active = !menuOpen && href === activeHref;
              return (
                <Link
                  key={href + label}
                  href={href}
                  className={cn(
                    "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] transition",
                    active
                      ? "text-blue-400"
                      : "text-white/50 hover:text-white/80"
                  )}
                >
                  <Icon size={22} strokeWidth={active ? 2.4 : 2} />
                  {label}
                </Link>
              );
            })}
            <button
              onClick={() => setMenuOpen(true)}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] transition",
                menuOpen
                  ? "text-blue-400"
                  : "text-white/50 hover:text-white/80"
              )}
            >
              <span className="relative">
                <Menu size={22} strokeWidth={menuOpen ? 2.4 : 2} />
                {notifCount > 0 && (
                  <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                    {notifCount > 99 ? "99+" : notifCount}
                  </span>
                )}
              </span>
              Menu
            </button>
          </nav>

          <NavMenuSheet
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            username={username}
            displayName={displayName}
            email={email}
            canActAs={canActAs}
            isAdmin={isAdmin}
            extras={extras}
          />
        </>
      )}
    </>
  );
}
