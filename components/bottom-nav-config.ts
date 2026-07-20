import type { LucideIcon } from "lucide-react";
import {
  CircleUser,
  Clapperboard,
  Compass,
  Download,
  Flame,
  House,
  Images,
  MessageCircle,
  Newspaper,
  Play,
  Search,
  SquarePlus,
  Store,
  Users,
} from "lucide-react";

export type BottomNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

// Sections with no natural subpages get cross-links to the most-used
// destinations instead — everything else is one Menu tap away.
const DEFAULT_ITEMS: BottomNavItem[] = [
  { label: "Home", href: "/", icon: House },
  { label: "Messages", href: "/messages", icon: MessageCircle },
  { label: "Posts", href: "/posts", icon: Newspaper },
];

// Ordered longest-prefix-first so /shorts18 wins over /shorts. Each section
// gets the three most useful in-section destinations; the rest stay in the
// section's own pill tabs and the shared Menu sheet. The 18+ section must
// stay strictly inside /shorts18 (never cross-link to main shorts).
const SECTIONS: {
  prefix: string;
  items: (ctx: { username: string }) => BottomNavItem[];
}[] = [
  {
    prefix: "/shorts18",
    items: () => [
      { label: "Videos", href: "/shorts18", icon: Flame },
      { label: "Explore", href: "/shorts18/explore", icon: Compass },
      { label: "Mine", href: "/shorts18/mine", icon: Clapperboard },
    ],
  },
  {
    prefix: "/shorts",
    items: () => [
      { label: "Videos", href: "/shorts", icon: Play },
      { label: "Explore", href: "/shorts/explore", icon: Compass },
      { label: "Mine", href: "/shorts/mine", icon: Clapperboard },
    ],
  },
  {
    // Posts has no top tab bar anymore, so the bottom bar carries all four
    // section destinations (profile lives in the Menu sheet).
    prefix: "/posts",
    items: () => [
      { label: "Feed", href: "/posts", icon: Newspaper },
      { label: "Explore", href: "/posts/explore", icon: Compass },
      { label: "Videos", href: "/posts/videos", icon: Play },
      { label: "Create", href: "/posts/create", icon: SquarePlus },
    ],
  },
  {
    prefix: "/store",
    items: () => [
      { label: "Discover", href: "/store", icon: Store },
      { label: "Search", href: "/store/search", icon: Search },
      { label: "Installed", href: "/store/installed", icon: Download },
    ],
  },
  {
    prefix: "/people",
    items: ({ username }) => [
      { label: "People", href: "/people", icon: Users },
      {
        label: "My profile",
        href: `/people/${encodeURIComponent(username)}`,
        icon: CircleUser,
      },
      { label: "Messages", href: "/messages", icon: MessageCircle },
    ],
  },
];

export function getBottomNavItems(
  pathname: string,
  ctx: { username: string }
): BottomNavItem[] {
  if (pathname === "/") {
    return [
      { label: "Messages", href: "/messages", icon: MessageCircle },
      { label: "Posts", href: "/posts", icon: Newspaper },
      { label: "Gallery", href: "/gallery", icon: Images },
    ];
  }
  for (const section of SECTIONS) {
    if (
      pathname === section.prefix ||
      pathname.startsWith(section.prefix + "/")
    ) {
      return section.items(ctx);
    }
  }
  return DEFAULT_ITEMS;
}

// Active item = the one whose href is the longest prefix of the current path,
// so on /posts/explore "Explore" wins over "Feed", and on your own /people
// page "My profile" wins over "People". Root href only matches exactly.
export function activeNavHref(
  pathname: string,
  items: BottomNavItem[]
): string | null {
  let best: string | null = null;
  for (const { href } of items) {
    const matches =
      href === "/"
        ? pathname === "/"
        : pathname === href || pathname.startsWith(href + "/");
    if (matches && (best === null || href.length > best.length)) {
      best = href;
    }
  }
  return best;
}
