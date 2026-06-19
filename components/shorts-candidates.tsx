"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Download, Check, RefreshCw, Loader2, Eye, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface Candidate {
  id: string;
  title: string | null;
  url: string;
  thumbnail: string | null;
  duration: number | null;
  view_count: number | null;
  downloaded: boolean;
}

function fmtDur(s: number | null): string {
  if (!s) return "";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}
function fmtViews(n: number | null): string {
  if (!n) return "";
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

// Manual download browser for one profile: lists available source clips with
// thumbnail + meta and lets the admin pick which to download (like old elite).
export default function ShortsCandidates({
  profileId,
  profileName,
  basePath = "/shorts",
}: {
  profileId: number;
  profileName: string;
  // Section base path, so the back link stays within the current section.
  basePath?: string;
}) {
  const [cands, setCands] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<Set<string>>(new Set());
  const [manualUrl, setManualUrl] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const [manualMsg, setManualMsg] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/shorts/profiles/${profileId}/candidates`);
      if (res.ok) {
        setCands((await res.json()).candidates || []);
      } else {
        setError((await res.json().catch(() => ({}))).error || "Failed to load videos");
      }
    } catch {
      setError("Failed to load videos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const download = async (c: Candidate) => {
    setBusy((s) => new Set(s).add(c.id));
    try {
      const res = await fetch(`/api/shorts/profiles/${profileId}/candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: c.id, url: c.url, title: c.title }),
      });
      if (res.ok) setDone((s) => new Set(s).add(c.id));
    } finally {
      setBusy((s) => {
        const n = new Set(s);
        n.delete(c.id);
        return n;
      });
    }
  };

  const addByUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = manualUrl.trim();
    if (!url) return;
    setManualBusy(true);
    setManualMsg(null);
    try {
      const res = await fetch(`/api/shorts/profiles/${profileId}/candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setManualMsg(d.alreadyDownloaded ? "Already downloaded." : "Downloaded ✓");
        setManualUrl("");
      } else {
        setManualMsg(d.error || "Download failed");
      }
    } catch {
      setManualMsg("Download failed");
    } finally {
      setManualBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-3 pb-24 pt-16 text-white">
      <div className="mb-4 flex items-center gap-2 px-1">
        <Link
          href={`${basePath}/profile/${profileId}`}
          className="rounded-full bg-white/10 p-1.5 transition active:scale-90"
          aria-label="Back"
        >
          <ChevronLeft size={18} />
        </Link>
        <div className="flex-1">
          <div className="text-lg font-semibold">Download — @{profileName}</div>
          <div className="text-xs text-white/50">Pick videos to download from the source.</div>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/70 hover:bg-white/15"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Manual add by URL — works even when the source can't be listed (private
          / embedding-disabled accounts), letting you grab individual videos. */}
      <form onSubmit={addByUrl} className="mb-5 flex flex-wrap items-center gap-2">
        <input
          value={manualUrl}
          onChange={(e) => setManualUrl(e.target.value)}
          placeholder="Paste a video URL to download…"
          className="min-w-0 flex-1 rounded-full bg-white/10 px-4 py-2 text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
        />
        <button
          type="submit"
          disabled={manualBusy || !manualUrl.trim()}
          className="flex items-center gap-1.5 rounded-full bg-rose-500 px-4 py-2 text-sm font-semibold transition active:scale-95 disabled:opacity-50"
        >
          {manualBusy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {manualBusy ? "Downloading…" : "Download"}
        </button>
        {manualMsg && <span className="text-xs text-white/60">{manualMsg}</span>}
      </form>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-16 text-white/50">
          <Loader2 size={18} className="animate-spin" /> Loading available videos…
        </div>
      )}
      {error && (
        <p className="py-8 text-center text-sm text-amber-400/90">
          {error}
          <br />
          <span className="text-white/50">
            You can still paste individual video URLs above to download them.
          </span>
        </p>
      )}

      {!loading && !error && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {cands.map((c) => {
            const isDone = c.downloaded || done.has(c.id);
            const isBusy = busy.has(c.id);
            return (
              <div
                key={c.id}
                className="overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/10"
              >
                <div className="relative aspect-[9/16] bg-black/40">
                  {c.thumbnail ? (
                    // Public TikTok/YT CDN thumbnail loaded directly — the SSRF
                    // image-proxy rejects these CDN IPs, and they need no auth.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.thumbnail}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                  <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between text-[10px] text-white drop-shadow">
                    <span className="flex items-center gap-0.5">
                      <Clock size={10} /> {fmtDur(c.duration)}
                    </span>
                    {c.view_count ? (
                      <span className="flex items-center gap-0.5">
                        <Eye size={10} /> {fmtViews(c.view_count)}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="p-2">
                  <p className="mb-2 line-clamp-2 h-8 text-[11px] text-white/70">
                    {c.title || "Untitled"}
                  </p>
                  <button
                    onClick={() => download(c)}
                    disabled={isDone || isBusy}
                    className={cn(
                      "flex w-full items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition active:scale-95",
                      isDone
                        ? "bg-emerald-500/20 text-emerald-300"
                        : isBusy
                          ? "bg-white/10 text-white/50"
                          : "bg-rose-500 text-white"
                    )}
                  >
                    {isDone ? (
                      <>
                        <Check size={14} /> Downloaded
                      </>
                    ) : isBusy ? (
                      <>
                        <Loader2 size={14} className="animate-spin" /> Downloading…
                      </>
                    ) : (
                      <>
                        <Download size={14} /> Download
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
