"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// Shared tab bar for the App Store section (mirrors posts-tabs / shorts-tabs).
export default function StoreTabs({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  const tabs = [
    { label: "Discover", href: "/store" },
    { label: "Search", href: "/store/search" },
    { label: "Installed", href: "/store/installed" },
    { label: "Saved", href: "/store/saved" },
    ...(isAdmin ? [{ label: "Manage", href: "/store/manage" }] : []),
  ];

  function activeHref(): string {
    if (pathname.startsWith("/store/search")) return "/store/search";
    if (pathname.startsWith("/store/installed")) return "/store/installed";
    if (pathname.startsWith("/store/saved")) return "/store/saved";
    if (pathname.startsWith("/store/manage")) return "/store/manage";
    return "/store";
  }
  const active = activeHref();

  return (
    <div className="fixed left-1/2 top-14 z-40 max-w-[96vw] -translate-x-1/2 overflow-x-auto">
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
