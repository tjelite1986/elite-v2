"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { label: "Videos", href: "/shorts" },
  { label: "Explore", href: "/shorts/explore" },
  { label: "Mine", href: "/shorts/mine" },
  { label: "Profiles", href: "/shorts/profiles" },
  { label: "Playlists", href: "/shorts/playlists" },
  { label: "Grab", href: "/shorts/grab" },
];

function activeHref(pathname: string): string {
  if (pathname.startsWith("/shorts/explore")) return "/shorts/explore";
  if (pathname.startsWith("/shorts/mine")) return "/shorts/mine";
  if (pathname.startsWith("/shorts/profiles") || pathname.startsWith("/shorts/profile"))
    return "/shorts/profiles";
  if (pathname.startsWith("/shorts/playlists")) return "/shorts/playlists";
  if (pathname.startsWith("/shorts/grab")) return "/shorts/grab";
  return "/shorts";
}

// Secondary tab bar for the Shorts section, floating just under the macOS menu
// bar. Mirrors old elite's Videos / Explore / Profiles / Playlists tabs.
export default function ShortsTabs() {
  const pathname = usePathname();
  const active = activeHref(pathname);
  const tabs = TABS;

  return (
    <div
      data-immersive-hide
      className="fixed left-1/2 top-14 z-40 max-w-[96vw] -translate-x-1/2 overflow-x-auto"
    >
      <div className="flex items-center gap-0.5 rounded-full bg-black/50 p-1 text-[13px] backdrop-blur ring-1 ring-white/10">
        {tabs.map((t) => (
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
