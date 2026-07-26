"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import {
  Eye,
  EyeOff,
  Maximize,
  Minimize,
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import ShortCard, { type FeedShort } from "@/components/short-card";

// Feed ordering modes for the top-center selector (matches lib/shorts
// parseShortsSort). "For You" reshuffles per visit via a client seed.
type SortMode = "new" | "foryou" | "following" | "liked" | "random";
const SORT_LABELS: Record<SortMode, string> = {
  foryou: "For You",
  new: "New",
  following: "Following",
  liked: "Liked",
  random: "Random",
};
const SORT_ORDER: readonly SortMode[] = [
  "foryou",
  "new",
  "following",
  "liked",
  "random",
];

// Parse a ?sort URL value into a known mode, or null if absent/invalid.
function parseSortParam(raw: string | null): SortMode | null {
  return raw && (SORT_ORDER as readonly string[]).includes(raw)
    ? (raw as SortMode)
    : null;
}

// Clip-length filter, split server-side at the shorts format's 60 seconds
// (lib/shorts SHORT_MAX_SECONDS). It crosses with the ordering mode rather than
// replacing it: "For You, but only the long ones" is the useful question.
type LengthFilter = "all" | "short" | "long";
const LENGTH_LABELS: Record<LengthFilter, string> = {
  all: "Any length",
  short: "Short",
  long: "Long",
};
const LENGTH_ORDER: readonly LengthFilter[] = ["all", "short", "long"];

export default function ShortsFeed({
  channel,
  focusId,
  profileId,
  playlistId,
  category,
  tag,
  handle,
  isAdmin = false,
  viewerId,
  basePath = "/shorts",
  fill = false,
  sort = "new",
  length: initialLength = "all",
  showModeSelector = false,
}: {
  channel: "main" | "18plus";
  focusId?: number;
  isAdmin?: boolean;
  // The current user's id, threaded to each card for the owner visibility toggle.
  viewerId: number;
  // Section base path, so the 18+ section's empty-state link stays in /shorts18.
  basePath?: string;
  // When set, the feed is scoped to a single auto-poll profile and the global
  // upload/admin action buttons are hidden.
  profileId?: number;
  // When set, the feed is scoped to a playlist.
  playlistId?: number;
  // When set, the channel feed is filtered to a single 18+ category.
  category?: string;
  // When set, the feed is scoped to clips whose caption carries this hashtag.
  tag?: string;
  // When set, the feed is scoped to a person handle (profile clips + owner
  // uploads across linked members) — the same scope as the profile grid.
  handle?: string;
  // Fill the parent instead of sizing against the viewport (used when the
  // feed is embedded in an overlay that already owns the layout).
  fill?: boolean;
  // Initial feed ordering mode — seeded from ?sort on the channel pages. After
  // mount the mode is client state (switched in-place, no navigation).
  sort?: SortMode;
  // Initial clip-length filter — seeded from ?length on the channel pages, so a
  // reload or Back lands in the same filter. Client state after mount.
  length?: LengthFilter;
  // Show the top-center expandable mode selector (main channel feeds only).
  showModeSelector?: boolean;
}) {
  // The LIVE URL wins over the focusId prop. We keep ?focus updated as the user
  // scrolls (replaceState), but on a Back-navigation Next restores the page's
  // server tree with the STALE prop from when the page was entered (e.g.
  // Explore → /shorts?focus=X, then scrolled to Y): the prop is still X while
  // the URL is Y, and Y is where the user actually is. Read the URL first, fall
  // back to the prop for a plain server render. Captured ONCE at mount so the
  // ?focus we rewrite while scrolling can't flip the initial mode mid-feed. A
  // focus always implies id-cursor loading ('new'): For You / Random paginate by
  // offset and can't anchor on a specific clip.
  const [effectiveFocus] = useState<number | undefined>(
    () =>
      (typeof window !== "undefined"
        ? Number(new URLSearchParams(window.location.search).get("focus")) ||
          undefined
        : undefined) ?? focusId
  );
  // Feed ordering mode is CLIENT STATE, not a URL round-trip. A deep-link focus
  // forces "new" (foryou/random paginate by offset and can't anchor a clip).
  // Switching modes resets the feed in place (see switchMode) — no navigation,
  // so the ?focus that scrolling writes can never linger and collapse every mode
  // back to "new" (the bug this replaced).
  // The LIVE URL's ?sort wins over the prop, for the same reason effectiveFocus
  // reads the URL: switchMode updates ?sort via replaceState WITHOUT a server
  // navigation, so on a Back-restore Next hands us the cached server tree with
  // the STALE `sort` prop from the original page load — but the browser has
  // restored the real URL, so ?sort there is the mode the user actually chose.
  // Only the offset-paginated modes (foryou/random) can't anchor a focus clip;
  // the id-ordered modes (new/following/liked) keep their mode with a focus.
  const [mode, setMode] = useState<SortMode>(() => {
    const fromUrl =
      typeof window !== "undefined"
        ? parseSortParam(new URLSearchParams(window.location.search).get("sort"))
        : null;
    const initial = fromUrl ?? sort;
    return effectiveFocus && (initial === "foryou" || initial === "random")
      ? "new"
      : initial;
  });
  // Latest mode, read inside async loaders to drop responses from a superseded
  // mode (a slow fetch that resolves after the user switched away).
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // Clip-length filter, read from the live URL for the same reason the mode is:
  // a Back-navigation restores the server tree with the prop from when the page
  // was entered, while the URL holds what the user actually picked.
  const [length, setLength] = useState<LengthFilter>(() => {
    const raw =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("length")
        : null;
    return raw === "short" || raw === "long" ? raw : initialLength;
  });
  // Same stale-response guard as the mode: a filter switch must drop the pages
  // still in flight for the previous one.
  const lengthRef = useRef(length);
  useEffect(() => {
    lengthRef.current = length;
  }, [length]);

  // One shuffle seed per shuffle-mode entry: For You / Random stay stable while
  // paginating, and reshuffle each time the user (re)selects them.
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 2147483646) + 1);
  const [modeOpen, setModeOpen] = useState(false);
  const [items, setItems] = useState<FeedShort[]>([]);
  // Opening from a grid tile: start the feed at that clip (older ones follow).
  const [cursor, setCursor] = useState<number | null>(
    effectiveFocus ? effectiveFocus + 1 : null
  );
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  // Backward pagination: clips NEWER than the top of the list, so a feed opened
  // mid-list from a grid tile can scroll up past its starting clip.
  const [prevCursor, setPrevCursor] = useState<number | null>(
    effectiveFocus ?? null
  );
  const [hasPrev, setHasPrev] = useState(Boolean(effectiveFocus));
  const [loadingPrev, setLoadingPrev] = useState(false);
  // Whether the initial jump to the focused clip has happened. Backward loading
  // is held until then so the jump and the prepend scroll compensation can't
  // race each other (state, not a ref: the top sentinel re-arms on re-render).
  const [focusJumped, setFocusJumped] = useState(!effectiveFocus);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [muted, setMuted] = useState(true);
  // Three independent toggles, each with its own button in the control cluster:
  // - chromeHidden: hide the overlay UI (rail, caption, progress). Persisted;
  //   long-pressing a clip still toggles it back.
  // - fullscreen: device fullscreen + hide the global nav chrome. Not persisted
  //   (re-entering needs a user gesture anyway).
  // - autoScroll: clips do not loop; when one ends the feed advances to the
  //   next. Persisted.
  const [chromeHidden, setChromeHidden] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [autoScroll, setAutoScroll] = useState(false);
  const [hint, setHint] = useState(false);
  // The view-control cluster is collapsed to a single chevron by default.
  const [controlsOpen, setControlsOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  // Monotonic id for the newest in-flight forward load, so a load superseded by
  // a mode switch neither clears the loading flag nor applies its page.
  const loadTokenRef = useRef(0);

  useEffect(() => {
    setChromeHidden(localStorage.getItem("shorts:chromeHidden") === "1");
    setAutoScroll(localStorage.getItem("shorts:autoScroll") === "1");
  }, []);

  // In fullscreen, flag the body so the global nav chrome (top menu bar,
  // Shorts/18+ tabs, category chips) hides too — a true fullscreen, not just a
  // bare clip. Cleared on exit and when leaving the feed.
  useEffect(() => {
    document.body.classList.toggle("shorts-immersive", fullscreen);
    return () => document.body.classList.remove("shorts-immersive");
  }, [fullscreen]);

  const toggleChrome = useCallback(() => {
    setChromeHidden((prev) => {
      const next = !prev;
      localStorage.setItem("shorts:chromeHidden", next ? "1" : "0");
      if (next) {
        setHint(true);
        setTimeout(() => setHint(false), 2500);
      }
      return next;
    });
  }, []);

  const toggleAutoScroll = useCallback(() => {
    setAutoScroll((prev) => {
      const next = !prev;
      localStorage.setItem("shorts:autoScroll", next ? "1" : "0");
      return next;
    });
  }, []);

  const toggleFullscreen = useCallback(() => {
    setFullscreen((prev) => {
      const next = !prev;
      if (next) {
        // Go true device-fullscreen too (hides the browser's address/system
        // bars). Needs the tap as a user gesture; best-effort + unsupported on
        // iOS for non-video elements, where the CSS immersive view still applies.
        document.documentElement.requestFullscreen?.().catch(() => {});
      } else if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
      return next;
    });
  }, []);

  // If the user leaves fullscreen via the system (back gesture / Esc), sync the
  // state so the layout and the button stay correct.
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) setFullscreen(false);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // Leave fullscreen if the feed unmounts (e.g. navigating away) while active.
  useEffect(() => {
    return () => {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, []);

  const load = useCallback(async () => {
    if (loading || !hasMore) return;
    const token = ++loadTokenRef.current;
    setLoading(true);
    try {
      const url = new URL("/api/shorts/feed", window.location.origin);
      url.searchParams.set("channel", channel);
      if (profileId) url.searchParams.set("profile", String(profileId));
      if (playlistId) url.searchParams.set("playlist", String(playlistId));
      if (category) url.searchParams.set("category", category);
      if (tag) url.searchParams.set("tag", tag);
      if (handle) url.searchParams.set("handle", handle);
      if (mode !== "new") {
        url.searchParams.set("sort", mode);
        url.searchParams.set("seed", String(seed));
      }
      if (length !== "all") url.searchParams.set("length", length);
      if (cursor) url.searchParams.set("cursor", String(cursor));
      const reqMode = mode;
      const reqLength = length;
      const res = await fetch(url.toString());
      // Drop the response if the user switched modes or length filters while it
      // was in flight — otherwise stale clips from the old feed get appended.
      if (res.ok && modeRef.current === reqMode && lengthRef.current === reqLength) {
        const data = await res.json();
        setItems((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          const fresh = (data.items as FeedShort[]).filter((i) => !seen.has(i.id));
          return [...prev, ...fresh];
        });
        setCursor(data.nextCursor);
        setHasMore(data.nextCursor !== null);
      }
    } finally {
      // Only the most recent load clears the flag — a stale load (superseded by
      // a mode switch) must not flip loading off while the new one is running.
      if (loadTokenRef.current === token) setLoading(false);
    }
  }, [channel, cursor, hasMore, loading, profileId, playlistId, category, tag, handle, mode, length, seed]);

  // Backward load: clips immediately newer than the current top, prepended.
  // Held until the initial focus jump is done; the prepend is committed
  // synchronously (flushSync) and the scroll compensated right after, so no
  // other effect can scroll in between.
  const loadPrev = useCallback(async () => {
    // Backward pagination needs an id-ordered feed; the seeded modes don't
    // have one (a focus always forces 'new' mode at mount).
    if (mode !== "new") return;
    if (loadingPrev || !hasPrev || prevCursor === null || !focusJumped) return;
    setLoadingPrev(true);
    try {
      const url = new URL("/api/shorts/feed", window.location.origin);
      url.searchParams.set("channel", channel);
      if (profileId) url.searchParams.set("profile", String(profileId));
      if (playlistId) url.searchParams.set("playlist", String(playlistId));
      if (category) url.searchParams.set("category", category);
      if (tag) url.searchParams.set("tag", tag);
      if (handle) url.searchParams.set("handle", handle);
      if (length !== "all") url.searchParams.set("length", length);
      url.searchParams.set("after", String(prevCursor));
      const res = await fetch(url.toString());
      if (res.ok) {
        const data = await res.json();
        const root = containerRef.current;
        // Anchor the current topmost clip, commit the prepend synchronously,
        // then shift the scroll by exactly how far that clip moved. Offsets are
        // multiples of the card height, so scroll-snap stays on a boundary.
        const first = root?.querySelector<HTMLElement>("[data-short-id]");
        const anchor =
          first && root
            ? {
                id: Number(first.dataset.shortId),
                // Visual offset of the anchor clip within the viewport.
                delta: first.offsetTop - root.scrollTop,
              }
            : null;
        flushSync(() => {
          setItems((prev) => {
            const seen = new Set(prev.map((p) => p.id));
            const fresh = (data.items as FeedShort[]).filter(
              (i) => !seen.has(i.id)
            );
            return fresh.length ? [...fresh, ...prev] : prev;
          });
          setPrevCursor(data.nextCursor);
          setHasPrev(data.nextCursor !== null);
        });
        if (anchor && root) {
          const el = root.querySelector<HTMLElement>(
            `[data-short-id="${anchor.id}"]`
          );
          // Set the position ABSOLUTELY (same visual offset for the anchor
          // clip), not relatively: on snap containers the browser itself may
          // already have followed the snapped clip when items were prepended
          // (scroll-snap re-snap), and a relative shift would double up.
          if (el) root.scrollTop = el.offsetTop - anchor.delta;
        }
      }
    } finally {
      setLoadingPrev(false);
    }
  }, [
    channel,
    prevCursor,
    hasPrev,
    loadingPrev,
    focusJumped,
    profileId,
    playlistId,
    category,
    tag,
    handle,
    mode,
    length,
  ]);

  // Switch the feed ordering mode in place (no navigation): reseed the shuffle
  // modes, clear any lingering ?focus from the URL, reset the feed, and let the
  // mode-driven load effect below fetch the first page.
  const switchMode = useCallback(
    (m: SortMode) => {
      if (m === mode) return;
      if (m === "foryou" || m === "random") {
        setSeed(Math.floor(Math.random() * 2147483646) + 1);
      }
      // Keep the URL shareable/back-restorable, but never leave a stale ?focus:
      // that is exactly what used to force every mode back to "new".
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.delete("focus");
        if (m === "foryou") url.searchParams.delete("sort");
        else url.searchParams.set("sort", m);
        window.history.replaceState(window.history.state, "", url.toString());
      }
      // A mode switch is always a fresh, unfocused feed. Bumping the load token
      // orphans any in-flight load, and clearing `loading` lets the mode effect
      // fetch immediately instead of being blocked by the old fetch.
      loadTokenRef.current++;
      setLoading(false);
      setItems([]);
      setCursor(null);
      setHasMore(true);
      setPrevCursor(null);
      setHasPrev(false);
      setFocusJumped(true);
      setActiveId(null);
      containerRef.current?.scrollTo({ top: 0 });
      setMode(m);
    },
    [mode]
  );

  // Switch the clip-length filter in place, the same way switchMode does: the
  // ordering mode and its shuffle seed survive, so "For You" stays the same
  // shuffle with only the long clips left in it.
  const switchLength = useCallback(
    (l: LengthFilter) => {
      if (l === length) return;
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.delete("focus");
        if (l === "all") url.searchParams.delete("length");
        else url.searchParams.set("length", l);
        window.history.replaceState(window.history.state, "", url.toString());
      }
      loadTokenRef.current++;
      setLoading(false);
      setItems([]);
      setCursor(null);
      setHasMore(true);
      setPrevCursor(null);
      setHasPrev(false);
      setFocusJumped(true);
      setActiveId(null);
      containerRef.current?.scrollTo({ top: 0 });
      setLength(l);
    },
    [length]
  );

  // Load the first page whenever the mode changes (and once on mount). The
  // reset above has already cleared items/cursor for a switch; on first mount
  // the initial cursor may point at a deep-linked focus clip.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, length]);

  // Infinite scroll via a sentinel near the end of the list.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) load();
      },
      { root: containerRef.current, rootMargin: "600px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [load]);

  // Backward infinite scroll via a sentinel at the top of the list.
  useEffect(() => {
    const el = topSentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadPrev();
      },
      { root: containerRef.current, rootMargin: "400px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadPrev]);

  // Track which card is in view (>=60% visible) to drive autoplay.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio >= 0.6) {
            const id = Number((e.target as HTMLElement).dataset.shortId);
            if (id) setActiveId(id);
          }
        }
      },
      { root, threshold: [0.6] }
    );
    const cards = root.querySelectorAll("[data-short-id]");
    cards.forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, [items]);

  // Keep ?focus in the URL in sync with the clip in view, so leaving the feed
  // (e.g. tapping into a profile) and pressing Back returns to THIS clip instead
  // of the top of the feed. replaceState => no history spam while scrolling.
  // Held until the initial deep-link jump lands so it can't overwrite the
  // targeted clip mid-jump.
  useEffect(() => {
    if (!activeId || !focusJumped) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("focus") === String(activeId)) return;
    url.searchParams.set("focus", String(activeId));
    window.history.replaceState(window.history.state, "", url.toString());
  }, [activeId, focusJumped]);

  // Jump to a shared clip once it's in the list (once only — backward loads
  // prepend items and this must not yank the view back to the starting clip).
  useEffect(() => {
    if (!effectiveFocus || focusJumped || !containerRef.current) return;
    const el = containerRef.current.querySelector(
      `[data-short-id="${effectiveFocus}"]`
    );
    if (el) {
      (el as HTMLElement).scrollIntoView();
      setFocusJumped(true);
    } else if (items.length > 0) {
      // The focused clip is gone (deleted): the first batch would have started
      // at it. Mark the jump done so backward loading isn't held forever.
      setFocusJumped(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, effectiveFocus, focusJumped]);

  // Auto-scroll: when a clip finishes (autoScroll disables looping), glide to
  // the next one. The active-card observer takes over from there.
  const advanceFrom = useCallback(
    (id: number) => {
      const root = containerRef.current;
      if (!root) return;
      const idx = items.findIndex((s) => s.id === id);
      const next = items[idx + 1];
      if (!next) return;
      root
        .querySelector(`[data-short-id="${next.id}"]`)
        ?.scrollIntoView({ behavior: "smooth" });
    },
    [items]
  );

  const controlBtn =
    "rounded-full bg-black/50 p-2 text-white ring-1 ring-white/10 backdrop-blur transition hover:bg-black/70";

  return (
    <div
      className={
        fullscreen
          ? "fixed inset-0 z-30 bg-black"
          : fill
            ? "relative h-full w-full bg-black"
            : // Stop above the global bottom bar (3.5rem + safe areas) so the
              // caption/creator overlay at the video's bottom stays visible;
              // fullscreen mode hides the bar and takes the full viewport.
              "relative w-full bg-black h-[calc(100dvh-3.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))]"
      }
    >
      <div
        ref={containerRef}
        // overscroll-y-contain: swiping past the top must not chain to the
        // browser's pull-to-refresh (it reloaded the page mid-feed on Android).
        // overflow-anchor:none: loadPrev compensates the scroll itself; the
        // browser's native scroll anchoring would double the shift on prepend.
        className="h-full w-full snap-y snap-mandatory overflow-y-scroll overscroll-y-contain [overflow-anchor:none]"
      >
        <div ref={topSentinelRef} className="h-px w-full" />
        {items.map((short) => (
          <div key={short.id} data-short-id={short.id} className="h-full w-full">
            <ShortCard
              short={short}
              active={activeId === short.id}
              muted={muted}
              onToggleMuted={() => setMuted((m) => !m)}
              viewerId={viewerId}
              categoryEditable={isAdmin && channel === "18plus"}
              isAdmin={isAdmin}
              chromeHidden={chromeHidden}
              onToggleChrome={toggleChrome}
              onToggleFullscreen={toggleFullscreen}
              autoAdvance={autoScroll}
              onEnded={() => advanceFrom(short.id)}
              onRemoved={(id) => setItems((prev) => prev.filter((s) => s.id !== id))}
            />
          </div>
        ))}

        <div ref={sentinelRef} className="h-1 w-full" />

        {!loading && items.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-white/60">
            <p>No clips yet.</p>
            <Link
              href={
                channel === "18plus"
                  ? `${basePath}/upload?channel=18plus`
                  : `${basePath}/upload`
              }
              className="rounded-full bg-rose-500 px-5 py-2 text-sm font-semibold text-white"
            >
              Upload the first one
            </Link>
          </div>
        )}
      </div>

      {/* Top-center feed mode selector: "For You ˅" expanding to the ordering
          modes. Switches the feed in place via switchMode — no navigation, so a
          scrolled-in ?focus can never collapse every mode back to "new". */}
      {showModeSelector && (
        <div
          data-immersive-hide
          className="absolute left-1/2 top-2 z-40 -translate-x-1/2"
        >
          <button
            onClick={() => setModeOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-full bg-black/50 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/10 backdrop-blur transition hover:bg-black/70"
          >
            {SORT_LABELS[mode]}
            {length !== "all" && (
              <span className="text-white/60">· {LENGTH_LABELS[length]}</span>
            )}
            <ChevronDown
              size={15}
              className={cn("transition-transform", modeOpen && "rotate-180")}
            />
          </button>
          {modeOpen && (
            <div className="absolute left-1/2 top-full mt-1.5 w-44 -translate-x-1/2 overflow-hidden rounded-xl bg-neutral-900/95 py-1 ring-1 ring-white/15 backdrop-blur">
              {SORT_ORDER.map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setModeOpen(false);
                    switchMode(m);
                  }}
                  className={cn(
                    "block w-full px-4 py-2.5 text-center text-sm transition hover:bg-white/10",
                    m === mode ? "font-semibold text-white" : "text-white/70"
                  )}
                >
                  {SORT_LABELS[m]}
                </button>
              ))}
              {/* Length is a second axis, not a sixth mode: it narrows whichever
                  ordering is selected, so it sits below its own divider. */}
              <div className="my-1 border-t border-white/10" />
              {LENGTH_ORDER.map((l) => (
                <button
                  key={l}
                  onClick={() => {
                    setModeOpen(false);
                    switchLength(l);
                  }}
                  className={cn(
                    "block w-full px-4 py-2.5 text-center text-sm transition hover:bg-white/10",
                    l === length ? "font-semibold text-white" : "text-white/70"
                  )}
                >
                  {LENGTH_LABELS[l]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Collapsible view-control cluster ("^^"): a single chevron by default,
          expanding to fullscreen / overlay show-hide / auto-scroll. Stays
          visible in every mode so nothing becomes unreachable. */}
      <div className="absolute right-2 top-2 z-40 flex flex-col items-end gap-1.5">
        <button
          onClick={() => setControlsOpen((v) => !v)}
          aria-label={controlsOpen ? "Collapse controls" : "Expand controls"}
          className={controlBtn}
        >
          {controlsOpen ? <ChevronsUp size={18} /> : <ChevronsDown size={18} />}
        </button>
        {controlsOpen && (
          <>
            <button
              onClick={toggleFullscreen}
              aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
              className={controlBtn}
            >
              {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>
            <button
              onClick={toggleChrome}
              aria-label={chromeHidden ? "Show overlay" : "Hide overlay"}
              className={controlBtn}
            >
              {chromeHidden ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
            <button
              onClick={toggleAutoScroll}
              aria-label={autoScroll ? "Auto-scroll off" : "Auto-scroll on"}
              className={cn(
                controlBtn,
                autoScroll && "bg-rose-500/90 ring-rose-300/40 hover:bg-rose-500"
              )}
            >
              <ChevronsDown size={18} />
            </button>
          </>
        )}
      </div>

      {hint && (
        <div className="pointer-events-none fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/75 px-4 py-2 text-sm font-medium text-white">
          Long-press a clip to show the controls again
        </div>
      )}
    </div>
  );
}
