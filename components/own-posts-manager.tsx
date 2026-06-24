"use client";

import { useState } from "react";
import { Layers, Loader2 } from "lucide-react";
import PostGrid from "@/components/post-grid";

// The owner's view of their own posts grid, with a selection mode to combine
// several single-image posts into one carousel ("stack"). The first post tapped
// becomes the cover and keeps its caption; the rest are appended in tap order.
export default function OwnPostsManager({ userId }: { userId: number }) {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const reset = () => {
    setSelecting(false);
    setSelected(new Set());
    setMsg(null);
  };

  const combine = async () => {
    if (selected.size < 2) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/posts/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        reset();
        setReloadKey((k) => k + 1);
      } else {
        setMsg(d.error || "Could not combine posts.");
      }
    } catch {
      setMsg("Could not combine posts.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-sm text-white/50">
          {selecting
            ? "Tap posts to combine — the first becomes the cover."
            : ""}
        </span>
        {selecting ? (
          <button
            onClick={reset}
            className="shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            Cancel
          </button>
        ) : (
          <button
            onClick={() => setSelecting(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-4 py-1.5 text-sm font-semibold transition hover:bg-white/15"
          >
            <Layers size={14} /> Combine into stack
          </button>
        )}
      </div>

      {msg && <p className="mb-2 text-xs text-red-300">{msg}</p>}

      <PostGrid
        query={{ scope: "user", id: String(userId) }}
        empty="No posts yet."
        reloadKey={reloadKey}
        select={{ active: selecting, selected, toggle }}
      />

      {selecting && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#1c1c22]/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
            <span className="text-sm text-white/70">
              {selected.size} post{selected.size === 1 ? "" : "s"} selected
            </span>
            <button
              onClick={combine}
              disabled={selected.size < 2 || busy}
              className="flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition active:scale-95 disabled:opacity-40"
            >
              {busy ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Layers size={16} />
              )}
              Combine{selected.size > 1 ? ` ${selected.size}` : ""} into stack
            </button>
          </div>
        </div>
      )}
    </>
  );
}
