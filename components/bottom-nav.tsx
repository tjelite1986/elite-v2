"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  activeNavHref,
  getBottomNavItems,
} from "@/components/bottom-nav-config";
import NavMenuSheet from "@/components/nav-menu-sheet";

// Global Messenger-style bottom nav: three per-section contextual links plus
// a Menu button (same everywhere) opening the shared menu sheet. Wraps the
// page content so it can also own the bottom padding that keeps content from
// hiding under the fixed bar.
export default function BottomNav({
  username,
  email,
  children,
}: {
  username: string;
  email: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the sheet when a menu link navigates away.
  useEffect(() => setMenuOpen(false), [pathname]);

  // /messages has its own bottom tab bar (MessagesShell) sized to the exact
  // viewport — no global bar and no extra padding there.
  const onMessages =
    pathname === "/messages" || pathname.startsWith("/messages/");
  // The shorts root pages are exact-viewport feeds; bottom padding would just
  // add a dead scroll gap under them.
  const fullBleed = pathname === "/shorts" || pathname === "/shorts18";

  const items = getBottomNavItems(pathname, { username });
  const activeHref = activeNavHref(pathname, items);

  return (
    <>
      <div
        className={cn(
          "pt-14",
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
              <Menu size={22} strokeWidth={menuOpen ? 2.4 : 2} />
              Menu
            </button>
          </nav>

          <NavMenuSheet
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            username={username}
            email={email}
          />
        </>
      )}
    </>
  );
}
