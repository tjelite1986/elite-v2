"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Search, UserRound } from "lucide-react";

interface Performer {
  slug: string;
  name: string;
  image_key: string | null;
  video_count: number;
  birthday: string | null;
  nationality: string | null;
}

// Performer index for the 18+ library: everyone credited on a video, most
// prolific first, each linking to their own profile page.
export default function PerformersBrowser() {
  const [performers, setPerformers] = useState<Performer[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/videos/performers");
        if (res.ok) setPerformers((await res.json()).performers);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? performers.filter((p) => p.name.toLowerCase().includes(q))
      : performers;
  }, [performers, query]);

  return (
    <div className="mx-auto w-full max-w-5xl px-3 pb-28 pt-4 text-white sm:px-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Performers</h1>
        <span className="text-xs text-white/40">{performers.length}</span>
      </div>

      <label className="mb-4 flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-2">
        <Search size={15} className="text-white/40" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search performers"
          className="w-full bg-transparent text-sm outline-none placeholder:text-white/30"
        />
      </label>

      {loading ? (
        <div className="grid place-items-center py-20 text-white/40">
          <Loader2 className="animate-spin" size={24} />
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-white/40">
          {performers.length === 0
            ? "No performers yet — they appear as videos get matched."
            : "No performer matches that."}
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-5">
          {filtered.map((p) => (
            <Link
              key={p.slug}
              href={`/videos18/performer/${p.slug}`}
              className="group text-center"
            >
              <div className="relative mx-auto aspect-square w-full overflow-hidden rounded-full bg-white/5">
                {p.image_key ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/videos/performers/${p.slug}/image`}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center text-white/20">
                    <UserRound size={26} />
                  </div>
                )}
              </div>
              <p className="mt-2 truncate text-sm font-medium">{p.name}</p>
              <p className="text-xs text-white/40">
                {p.video_count} {p.video_count === 1 ? "video" : "videos"}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
