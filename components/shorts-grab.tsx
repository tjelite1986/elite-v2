"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, Download, CheckCircle2, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

type Channel = "main" | "18plus";
type ImportedMap = { main: string | null; "18plus": string | null };
type ProfileItem = { id: string; title: string | null; filename: string; thumbnail: string | null; imported?: ImportedMap };
type Site = { domain: string; profiles: boolean | "limited" };

type Single = { creator: string; title: string | null; thumbnail: string | null; imported?: ImportedMap };
type Profile = { creator: string; count: number; items: ProfileItem[] };

export default function ShortsGrab() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sites, setSites] = useState<Site[]>([]);

  const [single, setSingle] = useState<Single | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const [channel, setChannel] = useState<Channel>("main");
  const [creator, setCreator] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [progress, setProgress] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    fetch("/api/shorts/grab/sites")
      .then((r) => r.json())
      .then((d) => setSites(d.sites || []))
      .catch(() => {});
    return () => esRef.current?.close();
  }, []);

  const reset = () => {
    setSingle(null);
    setProfile(null);
    setError(null);
    setProgress(null);
    setDone(null);
    setStatus({});
    setRunning(false);
    esRef.current?.close();
  };

  const fetchInfo = async () => {
    const u = url.trim();
    if (!u) return;
    reset();
    setBusy(true);
    try {
      // Profile first; fall back to single-video resolve.
      const pr = await fetch(`/api/shorts/grab/profile?url=${encodeURIComponent(u)}`);
      const pd = await pr.json();
      if (pd.ok && pd.isProfile) {
        setProfile({ creator: pd.creator, count: pd.count, items: pd.items || [] });
        setCreator(pd.creator || "");
        // Default-select clips not already in the (default) channel.
        setSelected(new Set((pd.items || []).filter((i: ProfileItem) => !i.imported?.main).map((i: ProfileItem) => i.id)));
        return;
      }
      const r = await fetch(`/api/shorts/grab/resolve?url=${encodeURIComponent(u)}`);
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "Could not resolve link");
      setSingle({ creator: d.creator, title: d.title, thumbnail: d.thumbnail, imported: d.imported });
      setCreator(d.creator || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  // Run the elite-v2 importer for a channel so grabbed clips appear right away.
  const runImport = useCallback(async (ch: Channel) => {
    try {
      const r = await fetch("/api/shorts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: ch }),
      });
      const d = await r.json().catch(() => ({}));
      router.refresh();
      return typeof d.imported === "number" ? d.imported : null;
    } catch {
      return null;
    }
  }, [router]);

  const grabSingle = async () => {
    if (!single) return;
    setBusy(true);
    setDone(null);
    setError(null);
    try {
      const qs = new URLSearchParams({ url: url.trim(), channel });
      if (creator.trim()) qs.set("creator", creator.trim());
      const r = await fetch(`/api/shorts/grab/download?${qs.toString()}`);
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "Download failed");
      setProgress("Importing…");
      const n = await runImport(channel);
      setProgress(null);
      setDone(d.saved === false ? "Already in the library." : `Saved & imported${n != null ? ` (${n})` : ""}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allSelected = profile ? selected.size === profile.items.length && profile.items.length > 0 : false;
  const toggleAll = () => {
    if (!profile) return;
    setSelected(allSelected ? new Set() : new Set(profile.items.map((i) => i.id)));
  };

  const grabProfile = () => {
    if (!profile || !selected.size) return;
    setRunning(true);
    setDone(null);
    setError(null);
    setStatus({});
    setProgress("Starting…");

    const qs = new URLSearchParams({
      url: url.trim(),
      channel,
      ids: Array.from(selected).join(","),
    });
    if (creator.trim()) qs.set("creator", creator.trim());

    const es = new EventSource(`/api/shorts/grab/download-all?${qs.toString()}`);
    esRef.current = es;
    es.onmessage = async (ev) => {
      const d = JSON.parse(ev.data);
      if (d.type === "start") setProgress(`Downloading ${d.total} clip(s)…`);
      else if (d.type === "progress") {
        setStatus((s) => ({ ...s, [d.id]: d.status }));
        setProgress(`${d.index}/${d.total} processed…`);
      } else if (d.type === "done") {
        es.close();
        setProgress("Importing…");
        const n = await runImport(channel);
        setRunning(false);
        setProgress(null);
        setDone(`Done: ${d.saved} saved, ${d.skipped} skipped, ${d.failed} failed${n != null ? ` · imported ${n}` : ""}.`);
      } else if (d.type === "error") {
        es.close();
        setRunning(false);
        setProgress(null);
        setError(d.error || "Download failed");
      }
    };
    es.onerror = () => {
      es.close();
      setRunning(false);
      setProgress(null);
      setError("Connection lost.");
    };
  };

  const chBtn = (c: Channel, label: string) => (
    <button
      type="button"
      onClick={() => setChannel(c)}
      className={cn(
        "rounded-full px-4 py-1.5 text-sm font-medium transition",
        channel === c ? "bg-white text-black" : "text-white/70 hover:text-white"
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-5">
      {/* URL input */}
      <div className="flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && fetchInfo()}
          placeholder="Paste a link from a supported site…"
          className="flex-1 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm outline-none focus:border-white/30"
        />
        <button
          onClick={fetchInfo}
          disabled={busy || !url.trim()}
          className="flex items-center gap-2 rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold transition active:scale-95 hover:bg-white/15 disabled:opacity-50"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
          Fetch
        </button>
      </div>

      {error && <p className="text-sm text-rose-400">{error}</p>}

      {/* Shared controls (channel + profile name) once something resolved */}
      {(single || profile) && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-0.5 rounded-full bg-black/40 p-1 ring-1 ring-white/10">
            {chBtn("main", "Main")}
            {chBtn("18plus", "18+")}
          </div>
          <input
            value={creator}
            onChange={(e) => setCreator(e.target.value)}
            placeholder="Profile name"
            className="min-w-[160px] flex-1 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm outline-none focus:border-white/30"
          />
        </div>
      )}

      {/* Single video */}
      {single && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex gap-3">
            {single.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={single.thumbnail} alt="" className="h-20 w-20 flex-none rounded-lg object-cover" />
            ) : null}
            <div className="min-w-0">
              <p className="font-medium">{single.title || "Untitled"}</p>
              <p className="text-sm text-white/50">@{single.creator}</p>
            </div>
          </div>
          <button
            onClick={grabSingle}
            disabled={busy}
            className="mt-4 flex w-fit items-center gap-2 rounded-full bg-rose-500 px-5 py-2.5 text-sm font-semibold transition active:scale-95 disabled:opacity-50"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            Download &amp; import
          </button>
        </div>
      )}

      {/* Profile */}
      {profile && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-white/60">
              @{profile.creator} — {profile.count} clips · {selected.size} selected
            </p>
            <button onClick={toggleAll} className="text-sm text-white/70 hover:text-white">
              {allSelected ? "Select none" : "Select all"}
            </button>
          </div>
          <div className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
            {profile.items.map((it) => {
              const st = status[it.id];
              return (
                <label
                  key={it.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-xl border border-white/5 px-3 py-2 transition",
                    selected.has(it.id) ? "bg-white/5" : "opacity-60"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(it.id)}
                    onChange={() => toggle(it.id)}
                    className="h-4 w-4 flex-none accent-rose-500"
                  />
                  {it.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.thumbnail} alt="" loading="lazy" className="h-12 w-12 flex-none rounded-md object-cover" />
                  ) : (
                    <div className="h-12 w-12 flex-none rounded-md bg-white/10" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm">{it.title || it.filename}</span>
                  {st && (
                    <span
                      className={cn(
                        "flex-none rounded-full px-2 py-0.5 text-xs",
                        st === "saved" ? "text-emerald-400" : st === "skipped" ? "text-amber-400" : st === "failed" ? "text-rose-400" : "text-white/50"
                      )}
                    >
                      {st}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
          <button
            onClick={grabProfile}
            disabled={running || !selected.size}
            className="flex w-fit items-center gap-2 rounded-full bg-rose-500 px-5 py-2.5 text-sm font-semibold transition active:scale-95 disabled:opacity-50"
          >
            {running ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            Download selected ({selected.size})
          </button>
        </div>
      )}

      {progress && (
        <p className="flex items-center gap-2 text-sm text-white/70">
          <Loader2 size={14} className="animate-spin" /> {progress}
        </p>
      )}
      {done && (
        <p className="flex items-center gap-2 text-sm text-emerald-400">
          <CheckCircle2 size={15} /> {done}
        </p>
      )}

      {/* Supported sites */}
      {sites.length > 0 && (
        <div className="border-t border-white/10 pt-4">
          <p className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wide text-white/40">
            <Globe size={12} /> Supported sites
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            {sites.map((s) => (
              <span key={s.domain} className="flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 ring-1 ring-white/10">
                <span className={cn("h-1.5 w-1.5 rounded-full", s.profiles === "limited" ? "bg-amber-400" : "bg-emerald-400")} />
                {s.domain}
              </span>
            ))}
            <span className="flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 ring-1 ring-white/10">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> + yt-dlp
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
