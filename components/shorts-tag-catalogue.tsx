"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Hash, Search } from "lucide-react";
import type { ShortTagSummary } from "@/lib/shorts";

// How many cards to show before "Show more". The library runs to ~1600 tags on
// the main channel, most of them used once — rendering every cover at once
// would be a thousand image requests for a page nobody scrolls to the end of.
const PAGE = 60;

// Every hashtag on a channel as a browsable category: a cover frame borrowed
// from the newest clip carrying it, the tag, and how many clips it holds. Each
// card opens the existing /tag/<tag> grid. basePath keeps the 18+ section inside
// /shorts18, which must never link across to the main one.
export default function ShortsTagCatalogue({
  tags,
  basePath,
}: {
  tags: ShortTagSummary[];
  basePath: "/shorts" | "/shorts18";
}) {
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/^#/, "");
    return needle ? tags.filter((t) => t.tag.includes(needle)) : tags;
  }, [tags, q]);

  if (!tags.length) {
    return (
      <p className="px-4 py-16 text-center text-sm text-white/50">
        No hashtags yet — captions with #tags turn into categories here.
      </p>
    );
  }

  const visible = filtered.slice(0, shown);

  return (
    <>
      <div className="relative mb-3 px-1">
        <Search
          size={16}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/40"
        />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            // A new search starts from the top of its own result list.
            setShown(PAGE);
          }}
          placeholder="Search categories"
          className="w-full rounded-full bg-white/10 py-2.5 pl-10 pr-4 text-sm text-white outline-none ring-1 ring-white/10 placeholder:text-white/40 focus:ring-white/25"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="px-4 py-16 text-center text-sm text-white/50">
          No category matches “{q.trim()}”.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {visible.map((t) => (
            <Link
              key={t.tag}
              href={`${basePath}/tag/${encodeURIComponent(t.tag)}`}
              className="group relative aspect-[4/3] overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/10 transition active:scale-[0.98]"
            >
              {t.coverId ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/shorts/${t.coverId}/poster?v=${t.coverV ?? "2"}`}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover opacity-70 transition group-hover:opacity-90"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-white/20">
                  <Hash size={32} />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-2.5">
                <p className="truncate text-sm font-semibold text-white">
                  #{t.tag}
                </p>
                <p className="text-xs text-white/60">
                  {t.count} {t.count === 1 ? "clip" : "clips"}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}

      {shown < filtered.length && (
        <button
          onClick={() => setShown((n) => n + PAGE)}
          className="mx-auto mt-4 block rounded-full bg-white/10 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-white/15 active:scale-95"
        >
          Show more ({filtered.length - shown} left)
        </button>
      )}
    </>
  );
}
