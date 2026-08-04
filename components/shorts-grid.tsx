"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Play, Heart, Pencil, Trash2, FolderInput, X, Plus, Check, Lock } from "lucide-react";
import { SHORT_CATEGORIES, CATEGORY_LABELS } from "@/lib/shorts-categories";
import ShortsEditSheet from "@/components/shorts-edit-sheet";
import { useBackDismiss } from "@/lib/use-back-dismiss";
import { useConfirm } from "@/components/confirm-dialog";
import GridDensity, { useGridCols, GRID_COL_CLASS } from "@/components/grid-density";

interface PickerProfile {
  id: number;
  name: string;
  clip_count: number;
}

// Clip-length filter, the grid's counterpart of the feed's (same server-side
// split at lib/shorts SHORT_MAX_SECONDS, same ?length param).
type LengthFilter = "all" | "short" | "long";
const LENGTH_LABELS: Record<LengthFilter, string> = {
  all: "All",
  short: "Short",
  long: "Long",
};
const LENGTH_ORDER: readonly LengthFilter[] = ["all", "short", "long"];

interface GridShort {
  id: number;
  caption: string | null;
  has_poster: boolean;
  poster_v: string | null;
  like_count: number;
  profile_name: string | null;
  category: string;
  is_private?: boolean;
  // Source dimensions, used to lay a wide clip out as a wide tile instead of
  // cropping it into the portrait one. Optional: tiles restored from an older
  // session cache predate these fields and fall back to portrait.
  width?: number | null;
  height?: number | null;
}

// A clip counts as landscape only when it is genuinely wider than tall — square
// and unmeasured clips keep the portrait tile.
function isLandscape(s: GridShort): boolean {
  return Boolean(s.width && s.height && s.width > s.height);
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
  restoreKey,
  isAdmin = false,
  lengthFilter = false,
}: {
  query: Record<string, string>;
  hrefPrefix: string;
  empty?: string;
  // Admins get a per-tile edit pencil (title / source / #tags) — the grid's
  // counterpart of the immersive card's 3-dot "Edit title".
  isAdmin?: boolean;
  // When set, the loaded tiles + scroll position are cached (sessionStorage)
  // under this key, so returning to this grid after opening a clip lands where
  // you left instead of scrolling back to the top. Must be unique per surface.
  restoreKey?: string;
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
  // Show the short/long segmented control above the tiles.
  lengthFilter?: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState<GridShort[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [moveId, setMoveId] = useState<number | null>(null);
  const [editClip, setEditClip] = useState<{ id: number; caption: string | null } | null>(null);
  const [confirmDialog, confirmAsk] = useConfirm();
  // Clip length, read from the live URL so a Back-navigation returns to the
  // same slice (switchLength writes it with replaceState — no server round-trip).
  const [length, setLength] = useState<LengthFilter>(() => {
    if (!lengthFilter || typeof window === "undefined") return "all";
    const raw = new URLSearchParams(window.location.search).get("length");
    return raw === "short" || raw === "long" ? raw : "all";
  });
  const [cols, switchCols] = useGridCols("shorts-grid-cols");
  const sentinel = useRef<HTMLDivElement>(null);
  // Orphans the pages still in flight when the filter changes, so tiles from
  // the previous filter can never land in the new list.
  const loadToken = useRef(0);
  // Device Back closes the move / edit sheet instead of leaving the page.
  useBackDismiss(moveId !== null, () => setMoveId(null));
  useBackDismiss(editClip !== null, () => setEditClip(null));

  const load = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const url = new URL("/api/shorts/feed", window.location.origin);
      url.searchParams.set("limit", "30");
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
      if (length !== "all") url.searchParams.set("length", length);
      if (cursor) url.searchParams.set("cursor", String(cursor));
      const token = ++loadToken.current;
      const res = await fetch(url.toString());
      if (res.ok && token === loadToken.current) {
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
  }, [cursor, hasMore, loading, query, length]);

  // Latest state, for the click-time cache save (the closure would otherwise
  // capture stale values).
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;

  // Cache the loaded tiles + current scroll so returning here lands where you
  // left. Saved on the TILE CLICK, not on unmount: Next scrolls the window to 0
  // as it navigates, before the component unmounts, so an unmount save would
  // record scrollY = 0.
  // One cache slot per filter: the tiles of "long" are not the tiles of "all",
  // and a Back-navigation has to land in the list it left.
  const cacheKey = "sg:" + restoreKey + (length === "all" ? "" : ":" + length);

  const saveCache = useCallback(() => {
    if (!restoreKey) return;
    try {
      sessionStorage.setItem(
        cacheKey,
        JSON.stringify({
          // Cache ALL loaded tiles (capped high only to bound storage): a
          // partial list would be shorter than the saved scroll offset, so the
          // page would clamp to the wrong place and the anchor tile would be
          // missing (the reported "lands in the wrong spot" after a deep scroll).
          items: itemsRef.current.slice(0, 800),
          cursor: cursorRef.current,
          hasMore: hasMoreRef.current,
          scrollY: window.scrollY,
          at: Date.now(),
        })
      );
    } catch {
      /* quota / private mode — position just won't restore */
    }
  }, [restoreKey, cacheKey]);

  // Restore-on-back: hydrate tiles + scroll from the cache instead of the
  // top-of-list initial load. Short-lived (5 min) so a deliberate fresh visit
  // later doesn't land mid-list. Runs post-mount (not in a useState initializer)
  // to avoid an SSR/hydration mismatch.
  useEffect(() => {
    let restored = false;
    if (restoreKey) {
      try {
        const raw = sessionStorage.getItem(cacheKey);
        if (raw) {
          const c = JSON.parse(raw);
          if (c?.items?.length && Date.now() - (c.at || 0) < 5 * 60 * 1000) {
            setItems(c.items);
            setCursor(c.cursor ?? null);
            setHasMore(c.hasMore ?? true);
            setLoadedOnce(true);
            restored = true;
            // Keep re-applying the offset for a few hundred ms: the tiles need a
            // frame or two to lay out (so the page is tall enough), and Next's
            // own back/forward scroll restoration fires around the same time and
            // would otherwise win and drop us at the top. Stop once it sticks.
            const targetY = c.scrollY || 0;
            let tries = 0;
            const apply = () => {
              window.scrollTo(0, targetY);
              tries++;
              if (Math.abs(window.scrollY - targetY) > 4 && tries < 40) {
                requestAnimationFrame(apply);
              }
            };
            requestAnimationFrame(apply);
          }
        }
      } catch {
        /* private mode / bad JSON — fall back to a normal load */
      }
    }
    if (!restored) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switch the length filter in place: empty the list, orphan the pages still
  // in flight, and let the effect below fetch the first page of the new slice.
  // The URL gets ?length via replaceState (no navigation), so Back returns here
  // with the filter intact — and the tile links carry it into the feed.
  const switchLength = (l: LengthFilter) => {
    if (l === length) return;
    loadToken.current++;
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (l === "all") url.searchParams.delete("length");
      else url.searchParams.set("length", l);
      window.history.replaceState(window.history.state, "", url.toString());
    }
    setLoading(false);
    setItems([]);
    setCursor(null);
    setHasMore(true);
    setLoadedOnce(false);
    window.scrollTo(0, 0);
    setLength(l);
  };

  // First page of a newly picked filter. Skipped on mount — the effect above
  // already loads (or restores) the initial list.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [length]);

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

  // Open the full title/source/tags editor (same sheet as the immersive card).
  const openEdit = (id: number, caption: string | null) =>
    setEditClip({ id, caption });

  const deleteClip = async (id: number) => {
    const ok = await confirmAsk({
      title: "Delete this clip?",
      message: "The video file is removed. This can't be undone.",
    });
    if (!ok) return;
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

  // A tile opens the feed at that clip — carry the filter along, so the clips
  // above and below it are the ones the grid was showing. hrefPrefix always
  // ends with "?focus=" or "&focus=" (except the selection-mode "#"), so the
  // parameter goes in front of it.
  const clipHref = (id: number) =>
    length === "all" || !hrefPrefix.includes("focus=")
      ? `${hrefPrefix}${id}`
      : `${hrefPrefix.replace(/focus=$/, `length=${length}&focus=`)}${id}`;

  // The control renders above the tiles AND above the empty state: a filter
  // that matches nothing must still be switchable, or it traps the surface.
  // The length filter and the density control share one row, so a surface that
  // has both doesn't stack two bars above the tiles.
  const controls = (
    <div className="mb-3 flex items-center gap-1 px-3">
      {lengthFilter &&
        LENGTH_ORDER.map((l) => (
          <button
            key={l}
            onClick={() => switchLength(l)}
            className={
              l === length
                ? "rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-black"
                : "rounded-full bg-white/10 px-4 py-1.5 text-sm text-white/70 transition hover:bg-white/15"
            }
          >
            {LENGTH_LABELS[l]}
          </button>
        ))}
      <GridDensity cols={cols} onChange={switchCols} className="ml-auto" />
    </div>
  );

  if (loadedOnce && items.length === 0) {
    return (
      <>
        {controls}
        <p className="px-4 py-16 text-center text-sm text-white/50">
          {/* The surface's own empty text would claim there is nothing here at
              all, which is false when a filter is what emptied it. */}
          {length === "all"
            ? empty
            : `No ${LENGTH_LABELS[length].toLowerCase()} clips here.`}
        </p>
      </>
    );
  }

  return (
    <>
      {controls}
      {/* Dense flow keeps the tiles packed. Only one-per-row lets a wide clip
          take the whole row at its own ratio — in the denser grids every tile
          is the same portrait shape, or the chosen density would not change
          the layout at all for a landscape-heavy channel. */}
      <div
        className={`grid grid-flow-row-dense gap-x-2 gap-y-2.5 px-2 ${GRID_COL_CLASS[cols]}`}
      >
        {items.map((s) => (
          <div
            key={s.id}
            className={
              cols === 1 && isLandscape(s)
                ? "group relative col-span-full overflow-hidden rounded-xl bg-white/5"
                : "group relative aspect-[9/16] overflow-hidden rounded-xl bg-white/5"
            }
            // The tile takes the clip's own ratio (16:9, 4:3, …), so the wide
            // poster fills it edge to edge without a crop.
            style={
              cols === 1 && isLandscape(s)
                ? { aspectRatio: `${s.width} / ${s.height}` }
                : undefined
            }
          >
            {(() => {
              const poster = s.has_poster ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/shorts/${s.id}/poster?v=${s.poster_v ?? "2"}`}
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
                <Link
                  href={clipHref(s.id)}
                  onClick={saveCache}
                  className="block h-full w-full"
                >
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
            {/* Admin edit pencil — the grid's counterpart of the immersive
                card's "Edit title" (title / source / #tags). Shown standalone
                for admins even when the fuller adminActions cluster is off. */}
            {isAdmin && !adminActions && !onSelect && (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openEdit(s.id, s.caption);
                }}
                className="absolute right-1 top-1 rounded bg-black/70 p-1 text-white ring-1 ring-white/20 transition active:scale-90"
                title="Edit title, source & tags"
                aria-label="Edit clip"
              >
                <Pencil size={13} />
              </button>
            )}
            {adminActions && (
              <div className="absolute right-1 top-1 flex gap-1">
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openEdit(s.id, s.caption);
                  }}
                  className="rounded bg-black/70 p-1 text-white ring-1 ring-white/20 transition active:scale-90"
                  title="Edit"
                  aria-label="Edit clip"
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
      {editClip && (
        <ShortsEditSheet
          shortId={editClip.id}
          caption={editClip.caption}
          onClose={() => setEditClip(null)}
          onSaved={(caption) => {
            setItems((list) =>
              list.map((s) => (s.id === editClip.id ? { ...s, caption } : s))
            );
            setEditClip(null);
          }}
        />
      )}
      {confirmDialog}
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
