"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GitMerge, X, Check } from "lucide-react";
import PostAvatar from "@/components/post-avatar";
import { useBackDismiss } from "@/lib/use-back-dismiss";

interface Account {
  username: string;
  display_name: string | null;
}

// Admin: merge another profile INTO this one (this one survives). Optionally
// rename the merged result. Files aren't moved — just the DB re-points.
export default function ProfileMergeButton({ targetHandle }: { targetHandle: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Device Back closes the merge sheet instead of leaving the page.
  useBackDismiss(open, () => setOpen(false));
  const [q, setQ] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [source, setSource] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const res = await fetch(`/api/posts/search?q=${encodeURIComponent(q.trim() || "a")}`);
      if (res.ok) {
        const d = await res.json();
        setAccounts(
          (d.accounts || [])
            .filter((a: { type: string; username: string }) => a.type === "creator" && a.username !== targetHandle)
            .map((a: { username: string; display_name: string | null }) => ({
              username: a.username,
              display_name: a.display_name,
            }))
        );
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, open, targetHandle]);

  const merge = async () => {
    if (!source || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/profiles/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetHandle, sourceHandle: source, newName: newName.trim() || undefined }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      setOpen(false);
      router.push(`/people/${d.handle}`);
      router.refresh();
    } else {
      setError(d.error || "Merge failed.");
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-1.5 text-sm font-semibold transition hover:bg-white/15"
      >
        <GitMerge size={14} /> Merge
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setOpen(false)}>
          <div
            className="flex max-h-[80%] flex-col rounded-t-2xl bg-neutral-900 text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <span className="font-semibold">Merge into @{targetHandle}</span>
              <button onClick={() => setOpen(false)} aria-label="Close">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-3 border-b border-white/10 p-3">
              <p className="text-xs text-white/50">
                Pick another profile — its photos and shorts move into @{targetHandle}
                and it&apos;s removed. Optionally rename the result.
              </p>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search a profile to merge in…"
                className="w-full rounded-full bg-white/10 px-4 py-2 text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
              />
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New name for the result (optional)"
                className="w-full rounded-full bg-white/10 px-4 py-2 text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
              />
            </div>

            {error && <p className="px-4 pt-2 text-xs text-rose-400">{error}</p>}

            <div className="flex-1 overflow-y-auto px-2 py-2">
              {accounts.map((a) => (
                <button
                  key={a.username}
                  onClick={() => setSource(a.username)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                    source === a.username ? "bg-rose-500/20" : "hover:bg-white/5"
                  }`}
                >
                  <PostAvatar username={a.username} size={36} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    @{a.username}
                  </span>
                  {source === a.username && <Check size={16} className="text-rose-400" />}
                </button>
              ))}
              {accounts.length === 0 && (
                <p className="px-2 py-3 text-sm text-white/50">No profiles match.</p>
              )}
            </div>

            <div className="border-t border-white/10 p-3">
              <button
                onClick={merge}
                disabled={!source || busy}
                className="w-full rounded-full bg-rose-500 px-5 py-2.5 text-sm font-semibold transition active:scale-95 disabled:opacity-50"
              >
                {busy ? "Merging…" : source ? `Merge @${source} in` : "Pick a profile"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
