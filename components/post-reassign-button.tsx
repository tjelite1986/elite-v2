"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UserCog, X, Check, Plus } from "lucide-react";
import PostAvatar from "@/components/post-avatar";
import { useBackDismiss } from "@/lib/use-back-dismiss";

interface Creator {
  id: number;
  username: string;
  display_name: string | null;
}

// Admin: reassign a post to a different mirrored creator (fixes wrong-creator
// imports). Opens a sheet to search existing creators or create a new one.
export default function PostReassignButton({
  postId,
}: {
  postId: number;
  currentCreatorId: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Device Back closes the reassign sheet instead of leaving the page.
  useBackDismiss(open, () => setOpen(false));
  const [q, setQ] = useState("");
  const [creators, setCreators] = useState<Creator[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const res = await fetch(
        `/api/posts/search?q=${encodeURIComponent(q.trim() || "a")}`
      );
      if (res.ok) {
        const d = await res.json();
        setCreators(
          (d.accounts || [])
            .filter((a: { type: string }) => a.type === "creator")
            .map((a: { username: string; display_name: string | null }) => ({
              id: 0,
              username: a.username,
              display_name: a.display_name,
            }))
        );
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, open]);

  const reassign = async (payload: { creatorId?: number; username?: string }) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/posts/${postId}/author`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setError(d.error || "Reassign failed.");
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-sm text-white/60 transition hover:text-white"
      >
        <UserCog size={15} /> Reassign
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setOpen(false)}>
          <div
            className="flex max-h-[70%] flex-col rounded-t-2xl bg-neutral-900 text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <span className="font-semibold">Reassign to creator</span>
              <button onClick={() => setOpen(false)} aria-label="Close">
                <X size={20} />
              </button>
            </div>

            <div className="border-b border-white/10 p-3">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search or type a new creator name…"
                className="w-full rounded-full bg-white/10 px-4 py-2 text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
              />
              {q.trim().length >= 2 &&
                !creators.some((c) => c.username === q.trim().toLowerCase()) && (
                  <button
                    onClick={() => reassign({ username: q.trim() })}
                    disabled={busy}
                    className="mt-2 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-white/5 disabled:opacity-50"
                  >
                    <span className="flex size-9 items-center justify-center rounded-full bg-rose-500">
                      <Plus size={16} />
                    </span>
                    Create + assign “{q.trim().toLowerCase()}”
                  </button>
                )}
            </div>

            {error && <p className="px-4 pt-2 text-xs text-rose-400">{error}</p>}

            <div className="flex-1 overflow-y-auto px-2 py-2">
              {creators.length === 0 && (
                <p className="px-2 py-3 text-sm text-white/50">No creators match.</p>
              )}
              {creators.map((c) => (
                <button
                  key={c.username}
                  onClick={() => reassign({ username: c.username })}
                  disabled={busy}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/5 disabled:opacity-50"
                >
                  <PostAvatar username={c.username} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      @{c.username}
                    </span>
                    {c.display_name && (
                      <span className="block truncate text-xs text-white/50">
                        {c.display_name}
                      </span>
                    )}
                  </span>
                  <Check size={16} className="shrink-0 text-white/30" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
