"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { label: "Feed", href: "/posts" },
  { label: "Explore", href: "/posts/explore" },
  { label: "Create", href: "/posts/create" },
  { label: "Profile", href: "/posts/me" },
];

function activeHref(pathname: string): string {
  if (pathname.startsWith("/posts/explore") || pathname.startsWith("/posts/tag"))
    return "/posts/explore";
  if (pathname.startsWith("/posts/create")) return "/posts/create";
  if (
    pathname.startsWith("/posts/me") ||
    pathname.startsWith("/posts/u/") ||
    pathname.startsWith("/posts/edit")
  )
    return "/posts/me";
  return "/posts";
}

// Secondary tab bar for the Photos section, mirroring the Shorts tab bar.
export default function PostsTabs() {
  const pathname = usePathname();
  const active = activeHref(pathname);
  const tabs = TABS;

  return (
    <div className="fixed left-1/2 top-14 z-40 max-w-[96vw] -translate-x-1/2 overflow-x-auto">
      <div className="flex items-center gap-0.5 rounded-full bg-black/50 p-1 text-[13px] backdrop-blur ring-1 ring-white/10">
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "whitespace-nowrap rounded-full px-3 py-1.5 font-medium transition",
              active === t.href ? "bg-white text-black" : "text-white/70 hover:text-white"
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
