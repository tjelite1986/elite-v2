"use client";

import { useEffect, useState } from "react";
import { LayoutGrid, Rows3 } from "lucide-react";
import { cn } from "@/lib/utils";
import ShortsGrid from "@/components/shorts-grid";
import ShortsFeed from "@/components/shorts-feed";

type View = "grid" | "feed";

// A shorts list with a view switcher: the Explore-style poster grid (nothing
// autoplays) or the immersive vertical feed where the clip in view plays.
// The feed renders as a viewport overlay (under the top nav) so the whole clip
// is visible — the profile header above would otherwise eat half the video.
// Both render the same handle scope. The chosen view is remembered per surface.
//
// Feed view lives in the URL (?fv=1), NOT React state + useBackDismiss: opening
// a clip's profile (its avatar → the SAME /people page) is a same-pathname
// navigation that keeps this component mounted, so a history-sentinel dismiss
// would fire on the way back and drop us to the grid. With ?fv=1 in the URL,
// Back naturally lands back on the feed (and a further Back, popping the ?fv=1
// entry, exits to the grid).
export default function ShortsViews({
  query,
  hrefPrefix,
  empty = "No clips yet.",
  storageKey,
  feed,
  restoreKey,
}: {
  query: Record<string, string>;
  hrefPrefix: string;
  empty?: string;
  // localStorage key that remembers the chosen view for this surface.
  storageKey: string;
  feed: {
    channel: "main" | "18plus";
    handle: string;
    viewerId: number;
    isAdmin: boolean;
  };
  // Passed to the grid so its scroll position + tiles survive opening a clip.
  restoreKey?: string;
}) {
  // Feed view is mirrored in the URL as ?fv=1 so Back restores it, but the render
  // is driven by local state (set synchronously by pick + re-derived on
  // popstate) — Next's useSearchParams does not reliably re-render on a bare
  // window.history.pushState.
  const [view, setView] = useState<View>("grid");
  // Wait until the saved-preference check has run before mounting a list, so we
  // never fetch one view's first page and immediately throw it away.
  const [ready, setReady] = useState(false);

  const hasFv = () =>
    new URLSearchParams(window.location.search).get("fv") === "1";

  useEffect(() => {
    if (hasFv()) {
      // Arrived on a feed URL (e.g. Back into the feed) — show it.
      setView("feed");
    } else {
      // Honour the remembered "feed" preference by adding ?fv=1 (a real history
      // entry, so Back still exits to the grid).
      try {
        if (window.localStorage.getItem(storageKey) === "feed") {
          const u = new URL(window.location.href);
          u.searchParams.set("fv", "1");
          window.history.pushState(window.history.state, "", u.toString());
          setView("feed");
        }
      } catch {
        /* private mode etc. — keep the grid default */
      }
    }
    setReady(true);
    // Back/forward across the ?fv=1 entry flips the view.
    const onPop = () => setView(hasFv() ? "feed" : "grid");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (v: View) => {
    try {
      window.localStorage.setItem(storageKey, v);
    } catch {
      /* non-persistent is fine */
    }
    if (v === "feed") {
      if (!hasFv()) {
        const u = new URL(window.location.href);
        u.searchParams.set("fv", "1");
        window.history.pushState(window.history.state, "", u.toString());
      }
      setView("feed");
    } else if (hasFv()) {
      // Pop the ?fv=1 entry (popstate → view = grid) so we don't leave a
      // dangling forward entry.
      window.history.back();
    } else {
      setView("grid");
    }
  };

  const btn = (v: View, icon: React.ReactNode, label: string) => (
    <button
      onClick={() => pick(v)}
      aria-label={label}
      className={cn(
        "rounded-full p-2 transition",
        view === v ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70"
      )}
    >
      {icon}
    </button>
  );

  return (
    <div>
      <div className="mb-1 flex justify-end px-2">
        <div className="flex items-center gap-1 rounded-full bg-white/5 p-0.5">
          {btn("grid", <LayoutGrid size={17} />, "Grid view")}
          {btn("feed", <Rows3 size={17} />, "Feed view")}
        </div>
      </div>
      {ready && (
        <ShortsGrid
          query={query}
          hrefPrefix={hrefPrefix}
          empty={empty}
          restoreKey={restoreKey}
        />
      )}
      {ready && view === "feed" && (
        <div className="fixed inset-x-0 bottom-0 top-0 z-40 bg-black">
          <ShortsFeed
            channel={feed.channel}
            handle={feed.handle}
            viewerId={feed.viewerId}
            isAdmin={feed.isAdmin}
            basePath={feed.channel === "18plus" ? "/shorts18" : "/shorts"}
            fill
          />
          {/* Back to the grid — mirrors the feed's control cluster styling. */}
          <button
            onClick={() => pick("grid")}
            aria-label="Back to grid"
            className="absolute left-2 top-2 z-40 rounded-full bg-black/50 p-2 text-white ring-1 ring-white/10 backdrop-blur transition hover:bg-black/70"
          >
            <LayoutGrid size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
