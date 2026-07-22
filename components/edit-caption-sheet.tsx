"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

// Bottom-sheet caption editor shared by the Videos card and the post lightbox.
// Posts store one caption; hashtags are re-derived server-side on save via
// PATCH /api/posts/[id]. Rendered as a fixed overlay (z above the lightbox) so
// it works from any surface.
export default function EditCaptionSheet({
  postId,
  initial,
  onClose,
  onSaved,
}: {
  postId: number;
  initial: string;
  onClose: () => void;
  onSaved: (caption: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption: value }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        onSaved(d.caption ?? null);
      } else {
        setError(d.error || "Could not save.");
      }
    } catch {
      setError("Could not save.");
    }
    setBusy(false);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl bg-neutral-900 p-5 pb-8 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-3 text-base font-semibold">Edit caption</p>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={4}
          maxLength={2200}
          autoFocus
          placeholder="Write a caption… #hashtags become links"
          className="w-full resize-none rounded-xl bg-white/10 px-4 py-2.5 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
        />
        {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
        <div className="mt-4 flex gap-3">
          <button
            onClick={save}
            disabled={busy}
            className="flex flex-1 items-center justify-center gap-2 rounded-full bg-rose-500 py-2.5 text-sm font-semibold transition active:scale-95 disabled:opacity-50"
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            Save
          </button>
          <button
            onClick={onClose}
            className="flex-1 rounded-full bg-white/10 py-2.5 text-sm font-semibold transition active:scale-95"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
