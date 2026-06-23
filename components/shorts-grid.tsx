"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Play, Heart, Pencil, Trash2, FolderInput, X, Plus, Check, Lock } from "lucide-react";
import { SHORT_CATEGORIES, CATEGORY_LABELS } from "@/lib/shorts-categories";

interface PickerProfile {
  id: number;
  name: string;
  clip_count: number;
}

interface GridShort {
  id: number;
  caption: string | null;
  has_poster: boolean;
  like_count: number;
  profile_name: string | null;
  category: string;
  is_private?: boolean;
}

// Responsive poster-thumbnail grid used by Explore, profile pages and playlists.
// Tapping a tile opens the immersive feed starting at that clip — its href is
// `${hrefPrefix}${id}` (a STRING, not a function: server components can't pass
// function props to a client component). `query` is the /api/shorts/feed scope.
export default function ShortsGrid({
  query,
  hrefPrefix,
  empty = "No clips yet.",
  categoryEditable = false,
  adminActions = false,
  channel,
  onSelect,
}: {
  query: Record<string, string>;
  hrefPrefix: string;
  empty?: string;
  // Admins in the 18+ section get a per-tile category selector to sort clips.
  categoryEditable?: boolean;
  // Admins get per-tile rename + delete buttons (used on profile pages).
  adminActions?: boolean;
  // When set, admins also get a per-tile "move to profile" button. The channel
  // scopes the profile picker so a clip never moves across main/18+.
  channel?: "main" | "18plus";
  // Selection mode: a tile calls onSelect(shortId) instead of opening the clip
  // (used to pick a profile picture from a clip's poster frame).
  onSelect?: (shortId: number) => void;
}) {
  const router = useRouter();
  const [items, setItems] = useState<GridShort[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [moveId, setMoveId] = useState<number | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const url = new URL("/api/shorts/feed", window.location.origin);
      url.searchParams.set("limit", "30");
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
      if (cursor) url.searchParams.set("cursor", String(cursor));
      const res = await fetch(url.toString());
      if (res.ok) {
        const data = await res.json();
        setItems((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...(data.items as GridShort[]).filter((i) => !seen.has(i.id))];
        });
        setCursor(data.nextCursor);
        setHasMore(data.nextCursor !== null);
      }
    } finally {
      setLoading(false);
      setLoadedOnce(true);
    }
  }, [cursor, hasMore, loading, query]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (e) => e[0].isIntersecting && load(),
      { rootMargin: "800px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [load]);

  const setCategory = async (id: number, category: string) => {
    // Optimistic: reflect the new bucket immediately, revert on failure.
    const prev = items;
    setItems((list) =>
      list.map((s) => (s.id === id ? { ...s, category } : s))
    );
    const res = await fetch(`/api/shorts/${id}/category`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category }),
    });
    if (!res.ok) setItems(prev);
  };

  const renameClip = async (id: number, current: string | null) => {
    const title = window.prompt("Title", current ?? "");
    if (title === null) return; // cancelled
    const res = await fetch(`/api/shorts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caption: title }),
    });
    if (res.ok) {
      const d = await res.json().catch(() => ({}));
      setItems((list) =>
        list.map((s) => (s.id === id ? { ...s, caption: d.caption ?? null } : s))
      );
    }
  };

  const deleteClip = async (id: number) => {
    if (!window.confirm("Delete this clip? The video file will be removed."))
      return;
    const res = await fetch(`/api/shorts/${id}`, { method: "DELETE" });
    if (res.ok) {
      setItems((list) => list.filter((s) => s.id !== id));
      router.refresh(); // update the server-rendered clip count
    }
  };

  // A clip reassigned to another profile leaves this (profile-scoped) view, so
  // drop it from the list and refresh the server-rendered clip count.
  const onMoved = (id: number) => {
    setMoveId(null);
    setItems((list) => list.filter((s) => s.id !== id));
    router.refresh();
  };

  if (loadedOnce && items.length === 0) {
    return <p className="px-4 py-16 text-center text-sm text-white/50">{empty}</p>;
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-5">
        {items.map((s) => (
          <div
            key={s.id}
            className="group relative aspect-[9/16] overflow-hidden rounded-md bg-white/5"
          >
            {(() => {
              const poster = s.has_poster ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/shorts/${s.id}/poster`}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover transition group-hover:opacity-80"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-white/30">
                  <Play size={28} />
                </div>
              );
              const overlay = (
                <>
                  {s.is_private && (
                    <div className="pointer-events-none absolute left-1 top-1 rounded bg-black/65 p-1 text-amber-300">
                      <Lock size={12} />
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1 text-[11px] text-white">
                    <Heart size={12} className="fill-white/90" />
                    {s.like_count}
                  </div>
                </>
              );
              return onSelect ? (
                <button onClick={() => onSelect(s.id)} className="block h-full w-full">
                  {poster}
                  {overlay}
                </button>
              ) : (
                <Link href={`${hrefPrefix}${s.id}`} className="block h-full w-full">
                  {poster}
                  {overlay}
                </Link>
              );
            })()}
            {categoryEditable && (
              <select
                value={(SHORT_CATEGORIES as string[]).includes(s.category) ? s.category : "uncategorized"}
                onChange={(e) => setCategory(s.id, e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="absolute left-1 top-1 max-w-[85%] rounded bg-black/70 px-1 py-0.5 text-[10px] text-white ring-1 ring-white/20 focus:outline-none"
                title="Set category"
              >
                {SHORT_CATEGORIES.map((c) => (
                  <option key={c} value={c} className="bg-neutral-800">
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            )}
            {adminActions && (
              <div className="absolute right-1 top-1 flex gap-1">
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    renameClip(s.id, s.caption);
                  }}
                  className="rounded bg-black/70 p-1 text-white ring-1 ring-white/20 transition active:scale-90"
                  title="Rename"
                  aria-label="Rename clip"
                >
                  <Pencil size={13} />
                </button>
                {channel && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setMoveId(s.id);
                    }}
                    className="rounded bg-black/70 p-1 text-white ring-1 ring-white/20 transition active:scale-90"
                    title="Move to profile"
                    aria-label="Move clip to another profile"
                  >
                    <FolderInput size={13} />
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    deleteClip(s.id);
                  }}
                  className="rounded bg-black/70 p-1 text-rose-300 ring-1 ring-white/20 transition active:scale-90 hover:text-rose-400"
                  title="Delete"
                  aria-label="Delete clip"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      <div ref={sentinel} className="h-1 w-full" />
      {loading && (
        <p className="py-4 text-center text-sm text-white/40">Loading…</p>
      )}
      {moveId !== null && channel && (
        <MoveSheet
          shortId={moveId}
          channel={channel}
          onClose={() => setMoveId(null)}
          onMoved={onMoved}
        />
      )}
    </>
  );
}

// Admin profile picker: reassign a clip to another profile on the same channel,
// or create a new manual profile on the fly and assign it. Used to fix imports
// that landed under a fallback/wrong profile.
function MoveSheet({
  shortId,
  channel,
  onClose,
  onMoved,
}: {
  shortId: number;
  channel: "main" | "18plus";
  onClose: () => void;
  onMoved: (id: number) => void;
}) {
  const [profiles, setProfiles] = useState<PickerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/shorts/profiles?channel=${channel}`)
      .then((r) => r.json())
      .then((d) => setProfiles(d.profiles || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [channel]);

  const assign = async (profileId: number) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/shorts/${shortId}/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId }),
    });
    if (res.ok) {
      onMoved(shortId);
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Move failed.");
      setBusy(false);
    }
  };

  const createAndAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/shorts/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, channel, source_type: "manual" }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Could not create profile.");
      setBusy(false);
      return;
    }
    const { profile } = await res.json();
    await assign(profile.id);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onClose}>
      <div
        className="flex max-h-[70%] flex-col rounded-t-2xl bg-neutral-900 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <span className="font-semibold">Move to profile</span>
          <button onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={createAndAssign} className="flex gap-2 border-b border-white/10 p-3">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New profile…"
            className="flex-1 rounded-full bg-white/10 px-4 py-2 text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
          />
          <button
            type="submit"
            disabled={busy || !newName.trim()}
            className="rounded-full bg-rose-500 p-2 transition active:scale-90 disabled:opacity-50"
            aria-label="Create profile and move"
          >
            <Plus size={18} />
          </button>
        </form>
        {error && <p className="px-4 pt-2 text-xs text-rose-400">{error}</p>}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {loading && <p className="px-2 text-sm text-white/50">Loading…</p>}
          {!loading && profiles.length === 0 && (
            <p className="px-2 text-sm text-white/50">
              No profiles yet — create one above.
            </p>
          )}
          {profiles.map((p) => (
            <button
              key={p.id}
              onClick={() => assign(p.id)}
              disabled={busy}
              className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left hover:bg-white/5 disabled:opacity-50"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{p.name}</span>
                <span className="text-xs text-white/50">{p.clip_count} clips</span>
              </span>
              <Check size={16} className="shrink-0 text-white/30" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
