"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import SearchResultList, {
  EMPTY,
  countResults,
  type Results,
} from "@/components/search-results";

// The /search page: one input, debounced, and the shared result list. The same
// list renders in the dashboard's search box (components/home-search.tsx).
export default function SearchClient({
  initialQuery = "",
}: {
  initialQuery?: string;
}) {
  const [q, setQ] = useState(initialQuery);
  const [results, setResults] = useState<Results>(EMPTY);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const term = q.trim();
    if (term.length < 2) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      const mySeq = ++seq.current;
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
        if (res.ok && mySeq === seq.current) setResults(await res.json());
      } finally {
        if (mySeq === seq.current) setLoading(false);
      }
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  const total = countResults(results);

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 pb-32 pt-20 text-white md:pt-24">
      <div className="mb-6 flex items-center gap-2 rounded-full bg-white/10 px-4 py-3">
        <Search size={18} className="text-white/50" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search posts, messages, photos, shorts, videos, books, people"
          className="w-full bg-transparent text-sm text-white placeholder-white/40 focus:outline-none"
        />
      </div>

      {q.trim().length < 2 ? (
        <p className="px-1 text-sm text-white/40">
          Type at least two characters to search everything you have access to.
        </p>
      ) : loading && total === 0 ? (
        <p className="px-1 text-sm text-white/40">Searching…</p>
      ) : total === 0 ? (
        <p className="px-1 text-sm text-white/40">No matches.</p>
      ) : (
        <SearchResultList results={results} />
      )}
    </main>
  );
}
