"use client";

import { useEffect, useState } from "react";
import { LayoutGrid, Rows3 } from "lucide-react";
import { cn } from "@/lib/utils";
import PostFeed from "@/components/post-feed";
import PostGrid from "@/components/post-grid";
import type { LightboxViewer } from "@/components/post-lightbox";

type View = "feed" | "grid";

// A post list with a view switcher: the classic vertical card feed, or the
// Explore-style 3-column thumbnail grid. Both render the same query and share
// the PostLightbox behavior. The chosen view is remembered per surface.
export default function PostViews({
  query,
  empty = "No posts yet.",
  viewer,
  storageKey,
  defaultView = "feed",
}: {
  query: Record<string, string>;
  empty?: string;
  viewer?: LightboxViewer;
  // localStorage key that remembers the chosen view for this surface.
  storageKey: string;
  defaultView?: View;
}) {
  const [view, setView] = useState<View>(defaultView);
  // Wait for the saved preference before mounting a list, so we never fetch
  // one view's first page and immediately throw it away for the other.
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
          {btn("feed", <Rows3 size={17} />, "Feed view")}
          {btn("grid", <LayoutGrid size={17} />, "Grid view")}
        </div>
      </div>
      {ready &&
        (view === "grid" ? (
          <PostGrid query={query} empty={empty} viewer={viewer} />
        ) : (
          <PostFeed query={query} empty={empty} viewer={viewer} />
        ))}
    </div>
  );
}
