"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Search, X } from "lucide-react";
import SearchResultList, {
  EMPTY,
  countResults,
  type Results,
} from "@/components/search-results";
import { useBackDismiss } from "@/lib/use-back-dismiss";

// Search box at the top of the dashboard. Hits the same /api/search as the
// /search page and renders the same result list (capped to a few rows per type),
// so everything searchable there — videos included — is reachable from home
// without leaving it. "See all results" hands the query over to /search.
export default function HomeSearch() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Results>(EMPTY);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const term = q.trim();
  const active = term.length >= 2;

  // Device Back clears the search instead of leaving the dashboard.
  useBackDismiss(active, () => setQ(""));

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
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
  }, [term]);

  const total = countResults(results);

  return (
    <div>
      <div className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-3">
        <Search size={17} className="shrink-0 text-white/50" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search videos, posts, photos, people…"
          aria-label="Search"
          className="w-full bg-transparent text-sm text-white placeholder-white/40 focus:outline-none"
        />
        {loading && (
          <Loader2 size={15} className="shrink-0 animate-spin text-white/40" />
        )}
        {q && !loading && (
          <button
            onClick={() => setQ("")}
            aria-label="Clear search"
            className="shrink-0 text-white/40 transition hover:text-white"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {active && (
        <div className="mt-3">
          {total === 0 ? (
            <p className="px-1 text-sm text-white/40">
              {loading ? "Searching…" : "No matches."}
            </p>
          ) : (
            <>
              <SearchResultList results={results} perSection={3} />
              <Link
                href={`/search?q=${encodeURIComponent(term)}`}
                className="mt-3 block rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-center text-sm text-white/70 transition hover:bg-white/10"
              >
                See all results
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
