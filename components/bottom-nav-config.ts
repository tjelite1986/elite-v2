import type { LucideIcon } from "lucide-react";
import {
  Bookmark,
  CircleUser,
  Clapperboard,
  Hash,
  Compass,
  Download,
  Film,
  Flame,
  House,
  Images,
  ListVideo,
  MessageCircle,
  Newspaper,
  Play,
  Search,
  SquarePlus,
  Store,
  Users,
  Wrench,
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

// Ordered longest-prefix-first so /shorts18 wins over /shorts. The sections
// have no top pill bars anymore: the bottom bar carries the four most useful
// in-section destinations and the overflow lives in the Menu sheet's
// section block (see getBottomNavExtras). The 18+ section must stay strictly
// inside /shorts18 (never cross-link to main shorts).
const SECTIONS: {
  prefix: string;
  items: (ctx: { username: string }) => BottomNavItem[];
}[] = [
  {
    // Long-form 18+ videos. Cross-links stay inside the 18+ realm — never to
    // the main video/shorts sections.
    prefix: "/videos18",
    items: () => [
      { label: "Videos 18+", href: "/videos18", icon: Film },
      { label: "Shorts 18+", href: "/shorts18", icon: Flame },
    ],
  },
  {
    prefix: "/videos",
    items: () => [
      { label: "Videos", href: "/videos", icon: Film },
      { label: "Shorts", href: "/shorts", icon: Play },
      { label: "Posts", href: "/posts", icon: Newspaper },
    ],
  },
  {
    prefix: "/shorts18",
    items: () => [
      { label: "Videos", href: "/shorts18", icon: Flame },
      { label: "Explore", href: "/shorts18/explore", icon: Compass },
      { label: "Profiles", href: "/shorts18/profiles", icon: Users },
      { label: "Playlists", href: "/shorts18/playlists", icon: ListVideo },
    ],
  },
  {
    prefix: "/shorts",
    items: () => [
      { label: "Videos", href: "/shorts", icon: Play },
      { label: "Explore", href: "/shorts/explore", icon: Compass },
      { label: "Profiles", href: "/shorts/profiles", icon: Users },
      { label: "Playlists", href: "/shorts/playlists", icon: ListVideo },
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
      { label: "Saved", href: "/store/saved", icon: Bookmark },
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

// Section destinations that don't fit the four bottom slots — surfaced as a
// contextual block at the top of the Menu sheet while inside that section.
export function getBottomNavExtras(
  pathname: string,
  ctx: { isAdmin: boolean }
): BottomNavItem[] {
  if (pathname === "/shorts18" || pathname.startsWith("/shorts18/")) {
    return [
      { label: "Categories", href: "/shorts18/tags", icon: Hash },
      { label: "Mine", href: "/shorts18/mine", icon: Clapperboard },
    ];
  }
  if (pathname === "/shorts" || pathname.startsWith("/shorts/")) {
    return [
      { label: "Categories", href: "/shorts/tags", icon: Hash },
      { label: "Mine", href: "/shorts/mine", icon: Clapperboard },
      { label: "Grab", href: "/shorts/grab", icon: Download },
    ];
  }
  if (pathname === "/store" || pathname.startsWith("/store/")) {
    return ctx.isAdmin
      ? [{ label: "Manage", href: "/store/manage", icon: Wrench }]
      : [];
  }
  return [];
}

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
