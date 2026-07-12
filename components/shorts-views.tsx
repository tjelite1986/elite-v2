"use client";

import { useEffect, useState } from "react";
import { LayoutGrid, Rows3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBackDismiss } from "@/lib/use-back-dismiss";
import ShortsGrid from "@/components/shorts-grid";
import ShortsFeed from "@/components/shorts-feed";

type View = "grid" | "feed";

// A shorts list with a view switcher: the Explore-style poster grid (nothing
// autoplays) or the immersive vertical feed where the clip in view plays.
// The feed renders as a viewport overlay (under the top nav) so the whole clip
// is visible — the profile header above would otherwise eat half the video.
// Both render the same handle scope. The chosen view is remembered per surface.
export default function ShortsViews({
  query,
  hrefPrefix,
  empty = "No clips yet.",
  storageKey,
  feed,
  defaultView = "grid",
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
  defaultView?: View;
}) {
  const [view, setView] = useState<View>(defaultView);
  // Wait for the saved preference before mounting a list, so we never fetch
  // one view's first page and immediately throw it away for the other.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved === "grid" || saved === "feed") setView(saved);
    } catch {
      /* private mode etc. — keep the default */
    }
    setReady(true);
  }, [storageKey]);

  const pick = (v: View) => {
    setView(v);
    try {
      window.localStorage.setItem(storageKey, v);
    } catch {
      /* non-persistent is fine */
    }
  };

  // Device Back leaves the fullscreen feed back to the grid instead of
  // leaving the profile page.
  useBackDismiss(ready && view === "feed", () => pick("grid"));

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
      {ready && <ShortsGrid query={query} hrefPrefix={hrefPrefix} empty={empty} />}
      {ready && view === "feed" && (
        <div className="fixed inset-x-0 bottom-0 top-14 z-40 bg-black">
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
