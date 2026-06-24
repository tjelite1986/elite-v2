"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search, Image as ImageIcon, Clapperboard, Lock } from "lucide-react";
import PostAvatar from "@/components/post-avatar";
import type { PersonEntry } from "@/lib/directory";

// Persisted in sessionStorage (survives a full remount/reload on back-nav, where
// a module-level var would be re-initialized), so returning from a profile
// restores the loaded list AND the scroll position instead of resetting to top.
interface DirCache {
  q: string;
  items: PersonEntry[];
  offset: number;
  nextOffset: number | null;
  total: number | null;
  scrollY: number;
}
const CACHE_KEY = "people-dir-v2";

function readCache(): DirCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as DirCache) : null;
  } catch {
    return null;
  }
}

// Browse everyone across the app — real users + mirrored photo/video creators —
// with chips linking to wherever each person has content.
export default function PeopleDirectory() {
  const cachedRef = useRef<DirCache | null>(null);
  if (cachedRef.current === null) cachedRef.current = readCache();
  const cached = cachedRef.current;

  const [q, setQ] = useState(cached?.q ?? "");
  const [items, setItems] = useState<PersonEntry[]>(cached?.items ?? []);
  const [offset, setOffset] = useState(cached?.offset ?? 0);
  // Start null on a fresh mount so the infinite-scroll observer can't fire a
  // load before the first fetch establishes real pagination — otherwise it
  // appends page 0 on top of the initial load and duplicates everyone.
  const [nextOffset, setNextOffset] = useState<number | null>(cached?.nextOffset ?? null);
  const [total, setTotal] = useState<number | null>(cached?.total ?? null);
  const [loading, setLoading] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydrated = useRef(Boolean(cached));
  // Latest state, mirrored for the scroll handler to persist without re-binding.
  const stateRef = useRef({ q, items, offset, nextOffset, total });
  stateRef.current = { q, items, offset, nextOffset, total };
  // Last known scroll position. Seeded from the cache so a mount/remount never
  // overwrites the saved position with the transient 0 it sits at before the
  // restore runs; only real scroll events advance it.
  const scrollYRef = useRef(cached?.scrollY ?? 0);
  // True while we're re-asserting the restored position — scroll events during
  // this window (incl. Next's own scroll-to-top on back-nav) must not clobber
  // the saved position.
  const restoringRef = useRef(Boolean(cached) && (cached?.scrollY ?? 0) > 0);

  const load = useCallback(
    async (reset: boolean) => {
      if (loading) return;
      const off = reset ? 0 : offset;
      if (!reset && nextOffset === null) return;
      setLoading(true);
      try {
        const url = new URL("/api/people", window.location.origin);
        if (q.trim()) url.searchParams.set("q", q.trim());
        url.searchParams.set("offset", String(off));
        const res = await fetch(url.toString());
        if (res.ok) {
          const d = await res.json();
          // Dedupe by handle when appending: a re-fired observer or an
          // overlapping page must never add a person already in the list
          // (handles are the React keys and are unique per person).
          setItems((prev) => {
            if (reset) return d.items;
            const seen = new Set(prev.map((x) => x.handle));
            return [
              ...prev,
              ...d.items.filter((x: PersonEntry) => !seen.has(x.handle)),
            ];
          });
          setOffset(d.nextOffset ?? off);
          setNextOffset(d.nextOffset);
          setTotal(d.total);
        }
      } finally {
        setLoading(false);
      }
    },
    [loading, offset, nextOffset, q]
  );

  // Reload from the top whenever the query changes (debounced). Skip the very
  // first run when we hydrated from cache — we already have those items.
  useEffect(() => {
    if (hydrated.current) {
      hydrated.current = false;
      return;
    }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      setItems([]);
      setOffset(0);
      setNextOffset(null);
      load(true);
    }, 250);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Restore scroll position once when returning from a profile. Next/the browser
  // can scroll back to top a moment after mount, so disable auto-restoration and
  // keep re-asserting our target until it sticks (content height settled), a
  // ~2.5s window elapses, or the user scrolls.
  useEffect(() => {
    if (!cached || cached.scrollY <= 0) return;
    const y = cached.scrollY;
    const prevRestore = history.scrollRestoration;
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";

    // Re-assert the position every frame for ~3s. Next/the browser can scroll to
    // top several times after a back-nav (it settles by ~2.8s here); forcing the
    // target is a no-op once we're already there, and snaps back when nudged.
    let stop = false;
    const start = performance.now();
    const tick = () => {
      if (stop) return;
      if (window.scrollY !== y) window.scrollTo(0, y);
      if (performance.now() - start > 3000) {
        restoringRef.current = false;
        scrollYRef.current = window.scrollY;
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    // The user taking over ends the restore immediately.
    const cancel = () => {
      stop = true;
      restoringRef.current = false;
      scrollYRef.current = window.scrollY;
    };
    window.addEventListener("wheel", cancel, { passive: true, once: true });
    window.addEventListener("touchstart", cancel, { passive: true, once: true });
    window.addEventListener("keydown", cancel, { once: true });

    return () => {
      stop = true;
      restoringRef.current = false;
      window.removeEventListener("wheel", cancel);
      window.removeEventListener("touchstart", cancel);
      window.removeEventListener("keydown", cancel);
      if ("scrollRestoration" in history) history.scrollRestoration = prevRestore;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the loaded list + last known scroll position so a return restores
  // them. scrollY comes from scrollYRef (advanced only by real scrolls), never
  // from window.scrollY at mount — which is 0 before the restore runs.
  const persist = useCallback(() => {
    try {
      sessionStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ ...stateRef.current, scrollY: scrollYRef.current })
      );
    } catch {
      /* quota / disabled — degrade to no restore */
    }
  }, []);
  useEffect(() => {
    persist();
  }, [q, items, offset, nextOffset, total, persist]);
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf || restoringRef.current) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (restoringRef.current) return;
        scrollYRef.current = window.scrollY;
        persist();
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [persist]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (e) => e[0].isIntersecting && nextOffset !== null && load(false),
      { rootMargin: "600px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [load, nextOffset]);

  return (
    <div className="mx-auto max-w-2xl px-3 pb-24 pt-24 text-white">
      <div className="mb-4 flex items-center gap-2 rounded-full bg-white/10 px-4 py-2.5">
        <Search size={16} className="text-white/50" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search people"
          className="w-full bg-transparent text-sm placeholder-white/40 focus:outline-none"
        />
      </div>

      {total !== null && (
        <p className="mb-2 px-1 text-xs text-white/40">{total} people</p>
      )}

      {/* Capture the scroll position the instant any link is clicked (before the
          outgoing navigation scrolls the window to top), and block further scroll
          writes so it can't be clobbered while this page is still mounted. */}
      <div
        className="space-y-1.5"
        onClickCapture={() => {
          scrollYRef.current = window.scrollY;
          restoringRef.current = true;
          persist();
        }}
      >
        {items.map((p) => (
          <PersonRow key={p.handle} person={p} />
        ))}
      </div>

      <div ref={sentinel} className="h-1 w-full" />
      {loading && <p className="py-4 text-center text-sm text-white/40">Loading…</p>}
      {!loading && items.length === 0 && (
        <p className="py-16 text-center text-sm text-white/50">No people found.</p>
      )}
    </div>
  );
}

function Chip({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      onClick={(e) => e.stopPropagation()}
      className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white/80 transition hover:bg-white/15 hover:text-white"
    >
      {icon}
      {label}
    </Link>
  );
}

function PersonRow({ person: p }: { person: PersonEntry }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white/5 p-2.5">
      <Link href={`/people/${p.handle}`}>
        <PostAvatar username={p.handle} size={48} />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link href={`/people/${p.handle}`} className="truncate text-sm font-semibold hover:underline">
            @{p.handle}
          </Link>
          {p.userId !== null && (
            <span className="rounded-full bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300">
              User
            </span>
          )}
        </div>
        {p.displayName && p.displayName !== p.handle && (
          <div className="truncate text-xs text-white/50">{p.displayName}</div>
        )}
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {p.photos > 0 && p.photosHref && (
            <Chip
              href={p.photosHref}
              icon={<ImageIcon size={12} />}
              label={`${p.photos} photo${p.photos === 1 ? "" : "s"}`}
            />
          )}
          {p.shortsMainId && (
            <Chip
              href={`/shorts/profile/${p.shortsMainId}`}
              icon={<Clapperboard size={12} />}
              label={`${p.shortsMain} short${p.shortsMain === 1 ? "" : "s"}`}
            />
          )}
          {p.shorts18Id && (
            <Chip
              href={`/shorts18/profile/${p.shorts18Id}`}
              icon={<Lock size={12} />}
              label={`${p.shorts18} 18+`}
            />
          )}
        </div>
      </div>
    </div>
  );
}
