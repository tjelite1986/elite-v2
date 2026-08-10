"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Film,
  Loader2,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Everything ThePornDB credits this performer with, next to what the library
// actually holds. The id is the point: it is what the Match box on a watch page
// takes, so a film with an unsearchable title can still be matched by hand.

interface TpdbRecord {
  id: string;
  type: "scene" | "movie";
  title: string;
  studio: string | null;
  date: string | null;
  duration: number | null;
  posterUrl: string | null;
  performers: string[];
  videoId: number | null;
}

function runtime(seconds: number | null): string | null {
  if (!seconds) return null;
  return `${Math.round(seconds / 60)} min`;
}

export default function PerformerTpdbScenes({ slug }: { slug: string }) {
  const [type, setType] = useState<"scene" | "movie">("scene");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<TpdbRecord[]>([]);
  const [meta, setMeta] = useState({ lastPage: 1, total: 0 });
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(
    async (nextType: "scene" | "movie", nextPage: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/videos/performers/${slug}/scenes?type=${nextType}&page=${nextPage}`
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || "Could not reach ThePornDB.");
          setItems([]);
          return;
        }
        setItems(data.items || []);
        setMeta({ lastPage: data.lastPage || 1, total: data.total || 0 });
        setPage(data.page || nextPage);
      } catch {
        setError("Could not reach the server.");
      } finally {
        setLoading(false);
        setLoaded(true);
      }
    },
    [slug]
  );

  // Only after the section is opened: this spends an API call per page view.
  useEffect(() => {
    if (loaded) void load(type, page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const copy = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
    } catch {
      /* clipboard access can be refused; the id is on screen either way */
    }
  };

  // The endpoint ignores a query, so filtering happens over the loaded page.
  const shown = filter.trim()
    ? items.filter((i) =>
        `${i.title} ${i.studio ?? ""}`
          .toLowerCase()
          .includes(filter.trim().toLowerCase())
      )
    : items;

  if (!loaded && !loading) {
    return (
      <div className="mt-6">
        <button
          onClick={() => void load(type, 1)}
          className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm transition hover:bg-white/10"
        >
          <Film size={14} />
          Browse their scenes on ThePornDB
        </button>
      </div>
    );
  }

  return (
    <section className="mt-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">On ThePornDB</h2>
        <div className="flex rounded-full border border-white/10 p-0.5 text-xs">
          {(["scene", "movie"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setType(t);
                setPage(1);
              }}
              className={cn(
                "rounded-full px-3 py-1 transition",
                type === t ? "bg-white text-black" : "text-white/60 hover:text-white"
              )}
            >
              {t === "scene" ? "Scenes" : "Movies"}
            </button>
          ))}
        </div>
        {meta.total > 0 && (
          <span className="text-xs text-white/40">
            {meta.total} {type === "scene" ? "scenes" : "movies"}
          </span>
        )}
        {loading && <Loader2 size={14} className="animate-spin text-white/40" />}
      </div>

      {error && (
        <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      {items.length > 0 && (
        <label className="mb-3 flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-2">
          <Search size={14} className="text-white/40" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter this page"
            className="w-full bg-transparent text-sm outline-none placeholder:text-white/30"
          />
        </label>
      )}

      <ul className="flex flex-col gap-1.5">
        {shown.map((item) => (
          <li
            key={item.id}
            className="flex gap-3 rounded-xl bg-white/[0.04] p-2 transition hover:bg-white/[0.07]"
          >
            <span className="relative block h-16 w-28 shrink-0 overflow-hidden rounded-lg bg-white/5">
              {item.posterUrl && (
                // The app's CSP is img-src 'self', so a third-party thumbnail
                // has to come through the proxy.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/image-proxy?url=${encodeURIComponent(item.posterUrl)}`}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {item.title}
              </span>
              <span className="block truncate text-xs text-white/45">
                {[item.studio, item.date?.slice(0, 10), runtime(item.duration)]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => copy(item.id)}
                  title="Copy the id — the Match box on a watch page takes it"
                  className="inline-flex items-center gap-1 rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-white/50 transition hover:bg-white/15 hover:text-white"
                >
                  {copied === item.id ? <Check size={10} /> : <Copy size={10} />}
                  {item.id}
                </button>
                {item.videoId ? (
                  <Link
                    href={`/videos18/${item.videoId}`}
                    className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300 transition hover:bg-emerald-500/25"
                  >
                    In library
                  </Link>
                ) : null}
              </span>
            </span>
          </li>
        ))}
      </ul>

      {loaded && !loading && shown.length === 0 && (
        <p className="py-6 text-center text-sm text-white/40">
          {items.length === 0
            ? `Nothing credited to them here.`
            : "Nothing on this page matches that."}
        </p>
      )}

      {meta.lastPage > 1 && (
        <div className="mt-3 flex items-center justify-center gap-3 text-sm">
          <button
            onClick={() => void load(type, page - 1)}
            disabled={page <= 1 || loading}
            className="inline-flex items-center gap-1 rounded-full border border-white/15 px-3 py-1.5 text-xs transition hover:bg-white/10 disabled:opacity-40"
          >
            <ChevronLeft size={14} />
            Previous
          </button>
          <span className="text-xs text-white/40">
            Page {page} of {meta.lastPage}
          </span>
          <button
            onClick={() => void load(type, page + 1)}
            disabled={page >= meta.lastPage || loading}
            className="inline-flex items-center gap-1 rounded-full border border-white/15 px-3 py-1.5 text-xs transition hover:bg-white/10 disabled:opacity-40"
          >
            Next
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </section>
  );
}
