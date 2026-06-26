"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBackDismiss } from "@/lib/use-back-dismiss";
import PostAvatar from "@/components/post-avatar";
import StoryViewer from "@/components/story-viewer";
import type { StoryGroup } from "@/lib/stories";

// Horizontal rail of story authors above the feed. The first tile is the
// viewer's own story (with a + to add one); the rest are followed users, with a
// gradient ring while unseen.
export default function StoryRail({ myUsername }: { myUsername: string }) {
  const [groups, setGroups] = useState<StoryGroup[]>([]);
  const [viewerAt, setViewerAt] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Device Back closes the fullscreen story viewer instead of leaving the feed.
  useBackDismiss(viewerAt !== null, () => setViewerAt(null));

  const load = async () => {
    try {
      const res = await fetch("/api/posts/stories");
      if (res.ok) setGroups((await res.json()).groups || []);
    } catch {
      /* noop */
    }
  };

  useEffect(() => {
    load();
  }, []);

  const upload = async (file: File) => {
    setUploading(true);
    const fd = new FormData();
    fd.set("file", file);
    try {
      await fetch("/api/posts/stories", { method: "POST", body: fd });
      await load();
    } finally {
      setUploading(false);
    }
  };

  const mine = groups.find((g) => g.isSelf);
  const others = groups.filter((g) => !g.isSelf);

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="*/*"
        hidden
        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
      />
      <div className="mb-3 flex gap-3 overflow-x-auto px-3 py-2" style={{ scrollbarWidth: "none" }}>
        {/* My story */}
        <button
          onClick={() => (mine ? setViewerAt(groups.indexOf(mine)) : fileRef.current?.click())}
          className="flex w-16 shrink-0 flex-col items-center gap-1"
        >
          <span className="relative">
            <span
              className={cn(
                "block rounded-full p-[2px]",
                mine && !mine.allViewed
                  ? "bg-gradient-to-tr from-rose-500 to-amber-400"
                  : "bg-white/15"
              )}
            >
              <span className="block rounded-full bg-black p-[2px]">
                <PostAvatar username={myUsername} size={56} />
              </span>
            </span>
            <span className="absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full border-2 border-black bg-rose-500 text-white">
              {uploading ? <Loader2 size={11} className="animate-spin" /> : <Plus size={12} />}
            </span>
          </span>
          <span className="max-w-full truncate text-[11px] text-white/70">Your story</span>
        </button>

        {/* Followed users' stories */}
        {others.map((g) => (
          <button
            key={g.userId}
            onClick={() => setViewerAt(groups.indexOf(g))}
            className="flex w-16 shrink-0 flex-col items-center gap-1"
          >
            <span
              className={cn(
                "block rounded-full p-[2px]",
                g.allViewed
                  ? "bg-white/15"
                  : "bg-gradient-to-tr from-rose-500 to-amber-400"
              )}
            >
              <span className="block rounded-full bg-black p-[2px]">
                <PostAvatar username={g.username} size={56} />
              </span>
            </span>
            <span className="max-w-full truncate text-[11px] text-white/70">{g.username}</span>
          </button>
        ))}
      </div>

      {viewerAt !== null && groups[viewerAt] && (
        <StoryViewer
          groups={groups}
          startGroup={viewerAt}
          onClose={() => {
            setViewerAt(null);
            load();
          }}
        />
      )}
    </>
  );
}
