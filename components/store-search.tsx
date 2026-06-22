"use client";

import { useEffect, useState, useCallback } from "react";
import { Search } from "lucide-react";
import type { AppCard } from "@/lib/store";
import StoreAppCard from "@/components/store-app-card";

const SORTS = [
  { key: "relevance", label: "Relevance" },
  { key: "rating", label: "Top Rated" },
  { key: "popular", label: "Popular" },
  { key: "newest", label: "Newest" },
];

export default function StoreSearch({
  initialQuery = "",
  initialSection = "",
  categories,
}: {
  initialQuery?: string;
  initialSection?: string;
  categories: string[];
}) {
  const [q, setQ] = useState(initialQuery);
  const [sort, setSort] = useState("relevance");
  const [section, setSection] = useState(initialSection);
  const [category, setCategory] = useState("");
  const [items, setItems] = useState<AppCard[]>([]);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (sort !== "relevance") params.set("sort", sort);
    if (section) params.set("section", section);
    if (category) params.set("category", category);
    try {
      const res = await fetch(`/api/store/search?${params.toString()}`);
      const json = await res.json();
      setItems(json.items || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [q, sort, section, category]);

  useEffect(() => {
    const t = setTimeout(run, 200);
    return () => clearTimeout(t);
  }, [run]);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 rounded-2xl bg-white/[0.06] px-3 py-2 ring-1 ring-white/10">
        <Search className="h-4 w-4 text-white/40" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search apps and games"
          className="w-full bg-transparent text-sm text-white placeholder-white/40 outline-none"
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="rounded-full bg-white/10 px-3 py-1.5 text-white outline-none"
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key} className="bg-neutral-900">
              {s.label}
            </option>
          ))}
        </select>
        <select
          value={section}
          onChange={(e) => setSection(e.target.value)}
          className="rounded-full bg-white/10 px-3 py-1.5 text-white outline-none"
        >
          <option value="" className="bg-neutral-900">
            All
          </option>
          <option value="apps" className="bg-neutral-900">
            Apps
          </option>
          <option value="games" className="bg-neutral-900">
            Games
          </option>
        </select>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="max-w-[40vw] rounded-full bg-white/10 px-3 py-1.5 text-white outline-none"
        >
          <option value="" className="bg-neutral-900">
            All categories
          </option>
          {categories.map((c) => (
            <option key={c} value={c} className="bg-neutral-900">
              {c}
            </option>
          ))}
        </select>
        {loading && <span className="text-white/40">Searching…</span>}
      </div>

      {items.length === 0 && !loading ? (
        <p className="py-10 text-center text-sm text-white/40">No results.</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((app) => (
            <StoreAppCard key={app.id} app={app} variant="row" />
          ))}
        </div>
      )}
    </div>
  );
}
