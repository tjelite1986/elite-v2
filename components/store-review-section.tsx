"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import type { AppReview } from "@/lib/store";
import StoreStars from "@/components/store-stars";
import { cn } from "@/lib/utils";

export default function StoreReviewSection({
  appId,
  reviews,
  myReview,
}: {
  appId: number;
  reviews: AppReview[];
  myReview: { rating: number; body: string | null } | null;
}) {
  const router = useRouter();
  const [rating, setRating] = useState(myReview?.rating || 0);
  const [body, setBody] = useState(myReview?.body || "");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!rating || busy) return;
    setBusy(true);
    try {
      await fetch(`/api/store/${appId}/review`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, body }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await fetch(`/api/store/${appId}/review`, { method: "DELETE" });
      setRating(0);
      setBody("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 className="mb-3 text-lg font-bold text-white">Ratings &amp; Reviews</h2>

      <div className="mb-4 rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10">
        <p className="mb-2 text-sm font-medium text-white/80">
          {myReview ? "Your review" : "Rate this app"}
        </p>
        <div className="mb-2 flex gap-1">
          {[1, 2, 3, 4, 5].map((i) => (
            <button key={i} onClick={() => setRating(i)} aria-label={`${i} stars`}>
              <Star
                className={cn(
                  "h-7 w-7",
                  i <= rating
                    ? "fill-amber-400 text-amber-400"
                    : "fill-transparent text-white/25"
                )}
              />
            </button>
          ))}
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write a review (optional)"
          rows={2}
          className="w-full resize-none rounded-xl bg-black/30 px-3 py-2 text-sm text-white placeholder-white/30 outline-none ring-1 ring-white/10"
        />
        <div className="mt-2 flex gap-2">
          <button
            onClick={submit}
            disabled={!rating || busy}
            className="rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-black disabled:opacity-40"
          >
            {myReview ? "Update" : "Submit"}
          </button>
          {myReview && (
            <button
              onClick={remove}
              disabled={busy}
              className="rounded-full bg-white/10 px-4 py-1.5 text-sm font-medium text-white/70"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {reviews.length === 0 && (
          <p className="text-sm text-white/40">No reviews yet.</p>
        )}
        {reviews.map((r) => (
          <div
            key={r.id}
            className="rounded-2xl bg-white/[0.03] p-3 ring-1 ring-white/5"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-white/90">
                @{r.author}
              </span>
              <StoreStars value={r.rating} size={12} />
            </div>
            {r.body && <p className="mt-1 text-sm text-white/70">{r.body}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
