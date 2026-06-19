"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// Tab bar for the separate 18+ Shorts section. A duplicate of ShortsTabs scoped
// to /shorts18 so the adult section never links back into the main /shorts URLs.
const TABS = [
  { label: "Videos", href: "/shorts18" },
  { label: "Explore", href: "/shorts18/explore" },
  { label: "Profiles", href: "/shorts18/profiles" },
  { label: "Playlists", href: "/shorts18/playlists" },
  { label: "Settings", href: "/shorts18/settings" },
];

function activeHref(pathname: string): string {
  if (pathname.startsWith("/shorts18/explore")) return "/shorts18/explore";
  if (
    pathname.startsWith("/shorts18/profiles") ||
    pathname.startsWith("/shorts18/profile")
  )
    return "/shorts18/profiles";
  if (pathname.startsWith("/shorts18/playlists")) return "/shorts18/playlists";
  if (
    pathname.startsWith("/shorts18/settings") ||
    pathname.startsWith("/shorts18/upload")
  )
    return "/shorts18/settings";
  return "/shorts18";
}

export default function Shorts18Tabs() {
  const pathname = usePathname();
  const active = activeHref(pathname);

  return (
    <div className="fixed left-1/2 top-14 z-40 max-w-[96vw] -translate-x-1/2 overflow-x-auto">
      <div className="flex items-center gap-0.5 rounded-full bg-black/50 p-1 text-[13px] backdrop-blur ring-1 ring-rose-500/30">
        <span className="ml-1 mr-1 rounded-full bg-rose-500/20 px-2 py-1 text-[11px] font-semibold uppercase text-rose-300">
          18+
        </span>
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "whitespace-nowrap rounded-full px-3 py-1.5 font-medium transition",
              active === t.href
                ? "bg-white text-black"
                : "text-white/70 hover:text-white"
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
