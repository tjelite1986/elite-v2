"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search, Image as ImageIcon, Clapperboard, Lock } from "lucide-react";
import PostAvatar from "@/components/post-avatar";
import type { PersonEntry } from "@/lib/directory";

// Browse everyone across the app — real users + mirrored photo/video creators —
// with chips linking to wherever each person has content.
export default function PeopleDirectory() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<PersonEntry[]>([]);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          setItems((prev) =>
            reset ? d.items : [...prev, ...d.items]
          );
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

  // Reload from the top whenever the query changes (debounced).
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      setItems([]);
      setOffset(0);
      setNextOffset(0);
      load(true);
    }, 250);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

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

      <div className="space-y-1.5">
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
