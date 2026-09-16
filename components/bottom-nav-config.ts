import type { LucideIcon } from "lucide-react";
import {
  Disc3,
  Heart,
  Download,
  Film,
  House,
  Images,
  ListMusic,
  MessageCircle,
  Music4,
  Search,
  Sparkles,
  Tags,
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
  { label: "Gallery", href: "/gallery", icon: Images },
];

// Ordered longest-prefix-first. The sections
// have no top pill bars anymore: the bottom bar carries the four most useful
// in-section destinations and the overflow lives in the Menu sheet's
// section block (see getBottomNavExtras). Neither shorts section appears here
// any more, and neither does posts: all three libraries are separate apps,
// reachable from the Menu sheet. A bar entry is an in-app Link, so it cannot
// point at one of them.
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
      { label: "Performers", href: "/videos18/performers", icon: Users },
      { label: "Analysis", href: "/videos18/analysis", icon: Sparkles },
    ],
  },
  {
    prefix: "/videos",
    items: () => [
      { label: "Videos", href: "/videos", icon: Film },
      { label: "Analysis", href: "/videos/analysis", icon: Sparkles },
      // No shorts or posts tab: those libraries are separate apps now.
    ],
  },
  {
    // The music section keeps the player's own destinations in the bar; the
    // mini player sits just above it, so this is what you see while listening.
    prefix: "/music",
    items: () => [
      { label: "Music", href: "/music", icon: Music4 },
      { label: "Albums", href: "/music/albums", icon: Disc3 },
      { label: "Playlists", href: "/music/playlists", icon: ListMusic },
      { label: "Search", href: "/music/search", icon: Search },
    ],
  },
];

// Section destinations that don't fit the four bottom slots — surfaced as a
// contextual block at the top of the Menu sheet while inside that section.
export function getBottomNavExtras(
  pathname: string,
  ctx: { isAdmin: boolean }
): BottomNavItem[] {
  if (pathname === "/music" || pathname.startsWith("/music/")) {
    return [
      { label: "Artists", href: "/music/artists", icon: Users },
      { label: "Favourites", href: "/music/favorites", icon: Heart },
      { label: "Genres", href: "/music/genres", icon: Tags },
      { label: "Downloads", href: "/music/downloads", icon: Download },
    ];
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
      { label: "Gallery", href: "/gallery", icon: Images },
      { label: "Videos", href: "/videos", icon: Film },
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
// so on /music/albums "Albums" wins over "Music". Root href only matches
// exactly.
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
