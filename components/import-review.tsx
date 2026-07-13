"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Loader2, Trash2 } from "lucide-react";

interface ReviewItem {
  id: number;
  user_id: number;
  original_name: string;
  collection: string | null;
  matched_post_id: number | null;
  matched_media_id: number | null;
  created_at: string;
  owner_email: string;
}

// Side-by-side review of import duplicates: files whose content matched an
// existing post were parked instead of deleted — compare and decide.
export default function ImportReview() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/import/review");
      if (res.ok) setItems((await res.json()).items || []);
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (id: number, action: "import" | "discard") => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch("/api/import/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Could not apply the decision.");
      }
      await load();
    } finally {
      setBusyId(null);
    }
  };

  if (items.length === 0) return null;

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-6">
      <div className="mb-1 flex items-center gap-2 font-semibold">
        <Copy size={16} /> Duplicates held for review ({items.length})
      </div>
      <p className="mb-4 text-sm text-white/50">
        These drop files matched an image the creator already has, so they were
        parked instead of deleted. Compare and decide.
      </p>

      <div className="space-y-4">
        {items.map((it) => (
          <div
            key={it.id}
            className="rounded-xl border border-white/10 bg-black/20 p-4"
          >
            <div className="mb-3 grid grid-cols-2 gap-3">
              <figure>
                <figcaption className="mb-1 text-xs font-medium text-white/50">
                  Incoming file
                </figcaption>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/import/review/${it.id}/media`}
                  alt=""
                  className="max-h-64 w-full rounded-lg bg-white/5 object-contain"
                />
              </figure>
              <figure>
                <figcaption className="mb-1 text-xs font-medium text-white/50">
                  Already imported (post #{it.matched_post_id})
                </figcaption>
                {it.matched_media_id ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/posts/media/${it.matched_media_id}`}
                    alt=""
                    className="max-h-64 w-full rounded-lg bg-white/5 object-contain"
                  />
                ) : (
                  <div className="flex h-32 items-center justify-center rounded-lg bg-white/5 text-xs text-white/40">
                    Matched post was deleted
                  </div>
                )}
              </figure>
            </div>

            <div data-pii className="truncate text-sm">
              {it.original_name}
            </div>
            <div className="text-xs text-white/40">
              {it.collection && <>creator {it.collection} · </>}
              dropped by {it.owner_email.split("@")[0]}
            </div>

            <div className="mt-3 flex gap-2">
              <button
                onClick={() => decide(it.id, "import")}
                disabled={busyId === it.id}
                className="flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-1.5 text-xs font-semibold transition hover:bg-blue-500 disabled:opacity-50"
              >
                {busyId === it.id ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Check size={13} />
                )}
                Import anyway
              </button>
              <button
                onClick={() => decide(it.id, "discard")}
                disabled={busyId === it.id}
                className="flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold text-white/70 transition hover:bg-white/15 disabled:opacity-50"
              >
                <Trash2 size={13} /> Discard
              </button>
            </div>
          </div>
        ))}
      </div>
      {error && <div className="mt-3 text-sm text-red-400">{error}</div>}
    </div>
  );
}
