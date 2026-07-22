"use client";

import { useEffect, useState } from "react";
import { LayoutGrid, Rows3 } from "lucide-react";
import { cn } from "@/lib/utils";
import PostGrid from "@/components/post-grid";
import VideosFeed from "@/components/videos-feed";

type View = "feed" | "grid";

// The Videos tab with a view switcher: the immersive vertical-swipe feed, or an
// Explore-style thumbnail grid (tapping a tile opens the shared lightbox, which
// plays video media). Both scope to video posts and share position restoration.
// The chosen view is remembered per surface; navigating into a clip's profile
// and back restores the view (localStorage) and the position (sessionStorage).
export default function VideosViews({
  viewer,
  storageKey,
  restoreKey,
}: {
  viewer: { userId: number; isAdmin: boolean };
  storageKey: string;
  restoreKey?: string;
}) {
  const [view, setView] = useState<View>("feed");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved === "feed" || saved === "grid") setView(saved);
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

  const controlBtn =
    "rounded-full bg-black/50 p-2 text-white ring-1 ring-white/10 backdrop-blur transition hover:bg-black/70";

  if (!ready) return null;

  if (view === "grid") {
    return (
      <div className="w-full pb-24 pt-2 text-white">
        <div className="mb-1 flex justify-end px-2">
          <div className="flex items-center gap-1 rounded-full bg-white/5 p-0.5">
            <button
              onClick={() => pick("feed")}
              aria-label="Feed view"
              className="rounded-full p-2 text-white/40 transition hover:text-white/70"
            >
              <Rows3 size={17} />
            </button>
            <button
              aria-label="Grid view"
              className="rounded-full bg-white/15 p-2 text-white"
            >
              <LayoutGrid size={17} />
            </button>
          </div>
        </div>
        <div className="px-2">
          <PostGrid
            query={{ scope: "explore", videos: "1" }}
            empty="No videos yet."
            viewer={viewer}
            restoreKey={restoreKey ? `${restoreKey}:grid` : undefined}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <VideosFeed
        viewer={viewer}
        restoreKey={restoreKey ? `${restoreKey}:feed` : undefined}
      />
      {/* Switch to the grid — top-left, clear of the feed's own controls. */}
      <button
        onClick={() => pick("grid")}
        aria-label="Grid view"
        className={cn(controlBtn, "absolute left-2 top-2 z-40")}
      >
        <LayoutGrid size={18} />
      </button>
    </div>
  );
}
