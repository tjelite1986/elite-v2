"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FolderOpen,
  Loader2,
  RefreshCw,
  Sparkles,
  Wand2,
  Search,
  Video as VideoIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import VideoCard, { type VideoCardData } from "@/components/video-card";
import TranscodeQueue from "@/components/transcode-queue";

interface LibraryVideo extends VideoCardData {
  description: string | null;
  width: number | null;
  height: number | null;
  size_bytes: number | null;
}

type Sort = "added" | "oldest" | "title" | "views" | "duration";

const SORT_LABELS: { value: Sort; label: string }[] = [
  { value: "added", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "title", label: "A–Z" },
  { value: "views", label: "Most viewed" },
  { value: "duration", label: "Longest" },
];

const PAGE_SIZE = 60;

// The video library browse surface: search, folder facets, sort, a
// continue-watching shelf and an infinite thumbnail grid. One component serves
// both channels — the 18+ section passes channel="adults" and its own basePath.
export default function VideosBrowser({
  channel,
  basePath,
  title,
  isAdmin,
  initialFolder = "",
  initialQuery = "",
  initialSort = "added",
}: {
  channel: "main" | "adults";
  basePath: string;
  title: string;
  isAdmin: boolean;
  // Seeded from the URL (?folder=…&q=…&sort=…) so a folder link from the watch
  // page lands on a pre-filtered library.
  initialFolder?: string;
  initialQuery?: string;
  initialSort?: Sort;
}) {
  const [videos, setVideos] = useState<LibraryVideo[]>([]);
  const [resume, setResume] = useState<LibraryVideo[]>([]);
  const [folders, setFolders] = useState<{ folder: string; count: number }[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState(initialQuery);
  const [debounced, setDebounced] = useState(initialQuery);
  const [folder, setFolder] = useState(initialFolder);
  const [sort, setSort] = useState<Sort>(initialSort);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [pendingConversions, setPendingConversions] = useState(0);
  const [queueOpen, setQueueOpen] = useState(false);
  const [converting, setConverting] = useState(false);
  const [pendingMeta, setPendingMeta] = useState(0);
  const [matching, setMatching] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const params = useCallback(
    (offset: number) => {
      const sp = new URLSearchParams({
        channel,
        sort,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (debounced) sp.set("q", debounced);
      if (folder) sp.set("folder", folder);
      return sp.toString();
    },
    [channel, sort, debounced, folder]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/videos?${params(0)}`);
      if (res.ok) {
        const data = await res.json();
        setVideos(data.videos);
        setResume(data.continueWatching);
        setFolders(data.folders);
        setTotal(data.total);
        setExhausted(data.videos.length < PAGE_SIZE);
      }
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    load();
  }, [load]);

  // Size of the conversion backlog (admins only — it drives the Convert button).
  const loadQueue = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await fetch(`/api/videos/transcode?channel=${channel}`);
      if (res.ok) {
        const data = await res.json();
        setPendingConversions(data.pending ?? 0);
        const running = Boolean(data.running);
        setConverting((was) => {
          // A run that just ended: report how it went and refresh the grid so
          // the converted rows lose their badge.
          if (was && !running) {
            if (data.lastRun?.message) setScanResult(data.lastRun.message);
            void load();
          }
          return running;
        });
      }
    } catch {
      /* the button just stays hidden */
    }
    // Metadata backlog (18+ only — there is no source for the main library).
    if (channel !== "adults") return;
    try {
      const res = await fetch("/api/videos/metadata");
      if (res.ok) {
        const data = await res.json();
        setPendingMeta(data.configured ? (data.pending ?? 0) : 0);
        const running = Boolean(data.running);
        setMatching((was) => {
          if (was && !running) {
            if (data.lastRun?.message) setScanResult(data.lastRun.message);
            void load();
          }
          return running;
        });
      }
    } catch {
      /* the button just stays hidden */
    }
  }, [isAdmin, load, channel]);

  useEffect(() => {
    loadQueue();
    // Poll often enough to notice a finished file while a run is going.
    const t = setInterval(loadQueue, converting || matching ? 10000 : 30000);
    return () => clearInterval(t);
  }, [loadQueue, converting, matching]);

  // Infinite scroll: fetch the next page when the sentinel comes into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || exhausted || loading) return;
    const io = new IntersectionObserver(async (entries) => {
      if (!entries[0].isIntersecting || loadingMore) return;
      setLoadingMore(true);
      try {
        const res = await fetch(`/api/videos?${params(videos.length)}`);
        if (res.ok) {
          const data = await res.json();
          setVideos((prev) => {
            // The offset can shift under us (a rescan during browsing), so drop
            // anything already on screen instead of rendering duplicate keys.
            const seen = new Set(prev.map((v) => v.id));
            return [
              ...prev,
              ...data.videos.filter((v: LibraryVideo) => !seen.has(v.id)),
            ];
          });
          if (data.videos.length < PAGE_SIZE) setExhausted(true);
        }
      } finally {
        setLoadingMore(false);
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [exhausted, loading, loadingMore, params, videos.length]);

  const rescan = async () => {
    setScanning(true);
    setScanResult(null);
    try {
      const res = await fetch(`/api/videos/scan?channel=${channel}`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setScanResult(data.error || "Scan failed.");
      } else {
        setScanResult(data.results?.[0]?.message || "Scan complete.");
        await load();
        await loadQueue();
      }
    } finally {
      setScanning(false);
    }
  };



  // Start the automatic metadata pass (sidecars first, then ThePornDB).
  const matchMetadata = async () => {
    try {
      const res = await fetch("/api/videos/metadata", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      setScanResult(res.ok ? data.message || "Started." : data.error || "Could not start.");
      if (data.started) setMatching(true);
    } catch {
      setScanResult("Could not reach the server.");
    } finally {
      await loadQueue();
    }
  };

  const hasFilters = Boolean(debounced || folder);
  const heading = useMemo(() => {
    if (debounced) return `Results for “${debounced}”`;
    if (folder) return folder;
    return "All videos";
  }, [debounced, folder]);

  return (
    <div className="mx-auto w-full max-w-7xl px-3 pb-28 pt-4 text-white sm:px-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{title}</h1>
        <span className="text-xs text-white/40">
          {total} {total === 1 ? "video" : "videos"}
        </span>
        {isAdmin && (
          <button
            onClick={rescan}
            disabled={scanning}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-xs font-medium transition hover:bg-white/10 disabled:opacity-50"
          >
            {scanning ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            {scanning ? "Scanning…" : "Rescan library"}
          </button>
        )}
        {isAdmin && pendingMeta > 0 && (
          <button
            onClick={matchMetadata}
            disabled={matching}
            title="Look up title, studio, performers and cover art"
            className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-xs font-medium transition hover:bg-white/10 disabled:opacity-50"
          >
            {matching ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            {matching ? "Matching…" : `Match ${pendingMeta}`}
          </button>
        )}
        {isAdmin && pendingConversions > 0 && (
          <button
            onClick={() => setQueueOpen(true)}
            title="Pick which files a browser cannot play to convert"
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 px-3 py-1.5 text-xs font-medium text-amber-200 transition hover:bg-amber-400/10 disabled:opacity-50"
          >
            {converting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Wand2 size={14} />
            )}
            {converting ? "Converting…" : `Convert ${pendingConversions}`}
          </button>
        )}
      </div>

      {scanResult && (
        <p className="mb-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70">
          {scanResult}
        </p>
      )}

      {/* Search + sort */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative flex min-w-0 flex-1 items-center">
          <Search size={15} className="absolute left-3 text-white/40" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search videos"
            className="w-full rounded-full border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm outline-none transition placeholder:text-white/30 focus:border-white/25"
          />
        </label>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          aria-label="Sort"
          className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/25"
        >
          {SORT_LABELS.map((s) => (
            <option key={s.value} value={s.value} className="bg-neutral-900">
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {/* Folder facets */}
      {folders.length > 0 && (
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <FolderChip
            label="All"
            active={folder === ""}
            onClick={() => setFolder("")}
          />
          {folders.map((f) => (
            <FolderChip
              key={f.folder}
              label={`${f.folder} (${f.count})`}
              active={folder === f.folder}
              onClick={() => setFolder(folder === f.folder ? "" : f.folder)}
            />
          ))}
        </div>
      )}

      {/* Continue watching */}
      {!hasFilters && resume.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-white/80">
            Continue watching
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {resume.map((v) => (
              <div key={v.id} className="w-56 shrink-0">
                <VideoCard video={v} basePath={basePath} />
              </div>
            ))}
          </div>
        </section>
      )}

      <h2 className="mb-2 text-sm font-semibold text-white/80">{heading}</h2>

      {loading ? (
        <div className="grid place-items-center py-20 text-white/40">
          <Loader2 className="animate-spin" size={26} />
        </div>
      ) : videos.length === 0 ? (
        <EmptyState channel={channel} filtered={hasFilters} isAdmin={isAdmin} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
            {videos.map((v) => (
              <VideoCard key={v.id} video={v} basePath={basePath} />
            ))}
          </div>
          <div ref={sentinel} className="h-10" />
          {loadingMore && (
            <div className="grid place-items-center py-4 text-white/40">
              <Loader2 className="animate-spin" size={20} />
            </div>
          )}
        </>
      )}

      {queueOpen && (
        <TranscodeQueue
          channel={channel}
          onClose={() => setQueueOpen(false)}
          onChanged={() => {
            void loadQueue();
            void load();
          }}
        />
      )}
    </div>
  );
}

function FolderChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
        active
          ? "border-white/30 bg-white/15 text-white"
          : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
      )}
    >
      <FolderOpen size={13} />
      {label}
    </button>
  );
}

function EmptyState({
  channel,
  filtered,
  isAdmin,
}: {
  channel: "main" | "adults";
  filtered: boolean;
  isAdmin: boolean;
}) {
  if (filtered) {
    return (
      <p className="py-16 text-center text-sm text-white/40">
        No videos match that filter.
      </p>
    );
  }
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <VideoIcon size={34} className="mx-auto mb-3 text-white/25" />
      <p className="text-sm text-white/60">No videos in this library yet.</p>
      <p className="mt-2 text-xs text-white/35">
        Drop files into{" "}
        <code className="rounded bg-white/10 px-1.5 py-0.5">
          /mnt/4tb/elitev3/videos/{channel}
        </code>{" "}
        — subfolders become collections.
        {isAdmin ? " Then hit Rescan library." : " An admin can then rescan."}
      </p>
    </div>
  );
}
