"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

// Toggle following a user or creator. Optimistic, reverts on failure.
export default function FollowButton({
  targetType,
  targetId,
  initialFollowing,
}: {
  targetType: "user" | "creator";
  targetId: number;
  initialFollowing: boolean;
}) {
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    const prev = following;
    setFollowing(!prev);
    try {
      const res = await fetch("/api/posts/follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType, targetId }),
      });
      if (res.ok) {
        const d = await res.json();
        setFollowing(d.following);
      } else {
        setFollowing(prev);
      }
    } catch {
      setFollowing(prev);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={cn(
        "rounded-full px-5 py-1.5 text-sm font-semibold transition active:scale-95 disabled:opacity-50",
        following
          ? "bg-white/10 text-white hover:bg-white/15"
          : "bg-rose-500 text-white"
      )}
    >
      {following ? "Following" : "Follow"}
    </button>
  );
}
