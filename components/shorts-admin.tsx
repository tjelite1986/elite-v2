"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Trash2, Plus, Radio, RefreshCw, Download } from "lucide-react";
import { cn } from "@/lib/utils";

interface Profile {
  id: number;
  name: string;
  channel: "main" | "18plus";
  source_type: "yt-dlp" | "rss" | "manual";
  source_ref: string;
  auto_poll: number;
  videos_limit: number;
  last_polled_at: string | null;
  clip_count?: number;
}

const EMPTY = {
  name: "",
  source_ref: "",
  channel: "main" as "main" | "18plus",
  source_type: "yt-dlp" as "yt-dlp" | "rss" | "manual",
  videos_limit: 20,
  // Off by default — new profiles are fetched manually via "Poll now"; enable
  // recurring auto-poll per profile when wanted.
  auto_poll: false,
};

// `channel`, when set, locks this admin panel to a single channel: new profiles
// are created on it, the channel selector is hidden, and only that channel's
// profiles are listed. This keeps the main and 18+ sections from managing each
// other's profiles. `basePath` keeps profile links within the current section.
export default function ShortsAdmin({
  channel,
  basePath = "/shorts",
}: {
  channel?: "main" | "18plus";
  basePath?: string;
} = {}) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [form, setForm] = useState({
    ...EMPTY,
    channel: channel ?? EMPTY.channel,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [polling, setPolling] = useState<Set<number>>(new Set());
  const pollWatch = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = async () => {
    const url = channel
      ? `/api/shorts/profiles?channel=${channel}`
      : "/api/shorts/profiles";
    const res = await fetch(url);
    if (res.ok) {
      const d = await res.json();
      setProfiles(d.profiles || []);
    }
  };

  useEffect(() => {
    refresh();
    return () => {
      if (pollWatch.current) clearInterval(pollWatch.current);
    };
  }, []);

  // After triggering downloads, refresh a few times so clip counts update live
  // as the background poller writes rows.
  const watchForClips = () => {
    if (pollWatch.current) clearInterval(pollWatch.current);
    let ticks = 0;
    pollWatch.current = setInterval(() => {
      refresh();
      if (++ticks >= 10 && pollWatch.current) {
        clearInterval(pollWatch.current);
        pollWatch.current = null;
      }
    }, 4000);
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/shorts/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setForm({ ...EMPTY, channel: channel ?? EMPTY.channel });
        await refresh();
        watchForClips(); // create() also kicks off an immediate poll server-side
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Failed to create");
      }
    } finally {
      setBusy(false);
    }
  };

  const pollNow = async (p: Profile) => {
    setPolling((s) => new Set(s).add(p.id));
    try {
      await fetch(`/api/shorts/profiles/${p.id}/poll`, { method: "POST" });
      watchForClips();
    } finally {
      setTimeout(() => {
        setPolling((s) => {
          const n = new Set(s);
          n.delete(p.id);
          return n;
        });
      }, 8000);
    }
  };

  const toggle = async (p: Profile) => {
    await fetch(`/api/shorts/profiles/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auto_poll: !p.auto_poll }),
    });
    refresh();
  };

  const remove = async (p: Profile) => {
    if (!confirm(`Delete profile "${p.name}"? Imported clips are kept.`)) return;
    await fetch(`/api/shorts/profiles/${p.id}`, { method: "DELETE" });
    refresh();
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 text-white">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Auto-poll profiles</h1>
        <button
          onClick={refresh}
          className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/15"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      <p className="mb-6 text-sm text-white/50">
        Use yt-dlp for TikTok / YouTube / most sites; RSS only for real feed URLs.
        New clips download and transcode automatically; counts update below.
      </p>

      {/* New profile */}
      <form
        onSubmit={create}
        className="mb-8 space-y-3 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10"
      >
        <div className="flex items-center gap-2 font-medium">
          <Plus size={16} /> New profile
        </div>
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder={
            form.source_type === "manual"
              ? "Name (required)"
              : "Name (optional — auto-detected from the source)"
          }
          className="w-full rounded-lg bg-white/10 px-3 py-2 text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
        />
        {form.source_type !== "manual" && (
          <input
            value={form.source_ref}
            onChange={(e) => setForm({ ...form, source_ref: e.target.value })}
            placeholder={
              form.source_type === "rss"
                ? "RSS/Atom feed URL"
                : "Channel/playlist URL (YouTube, TikTok, …)"
            }
            className="w-full rounded-lg bg-white/10 px-3 py-2 text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
          />
        )}
        <div className="flex flex-wrap gap-2">
          <Select
            value={form.source_type}
            onChange={(v) => setForm({ ...form, source_type: v as typeof form.source_type })}
            options={[
              ["yt-dlp", "yt-dlp"],
              ["rss", "RSS"],
              ["manual", "Manual (no poll)"],
            ]}
          />
          {!channel && (
            <Select
              value={form.channel}
              onChange={(v) => setForm({ ...form, channel: v as typeof form.channel })}
              options={[
                ["main", "Main"],
                ["18plus", "18+"],
              ]}
            />
          )}
          {form.source_type !== "manual" && (
            <>
              <label className="flex items-center gap-2 text-sm text-white/70">
                Limit
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={form.videos_limit}
                  onChange={(e) =>
                    setForm({ ...form, videos_limit: Number(e.target.value) })
                  }
                  className="w-16 rounded-lg bg-white/10 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/30"
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-white/70">
                <input
                  type="checkbox"
                  checked={form.auto_poll}
                  onChange={(e) => setForm({ ...form, auto_poll: e.target.checked })}
                />
                Auto-poll
              </label>
            </>
          )}
        </div>
        {form.source_type === "manual" && (
          <p className="text-xs text-white/40">
            Manual profile: no auto-poll. Clips arrive from the import folder or
            uploads.
          </p>
        )}
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-rose-500 px-5 py-2 text-sm font-semibold text-white transition active:scale-95 disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add profile"}
        </button>
      </form>

      {/* Existing profiles */}
      <div className="space-y-3">
        {profiles.length === 0 && (
          <p className="text-sm text-white/40">No profiles yet.</p>
        )}
        {profiles.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between gap-3 rounded-xl bg-white/5 p-4 ring-1 ring-white/10"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-medium">
                <Link href={`${basePath}/profile/${p.id}`} className="hover:underline">
                  {p.name}
                </Link>
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase text-white/60">
                  {p.channel === "18plus" ? "18+" : "main"}
                </span>
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">
                  {p.source_type}
                </span>
              </div>
              {p.source_ref && (
                <div className="truncate text-xs text-white/50">{p.source_ref}</div>
              )}
              <div className="mt-0.5 text-[11px] text-white/40">
                {p.clip_count ?? 0} clips
                {p.source_type !== "manual" && (
                  <>
                    {" · "}limit {p.videos_limit} ·{" "}
                    {p.last_polled_at ? `polled ${p.last_polled_at}` : "never polled"}
                  </>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {p.source_type !== "manual" && (
                <>
                  <button
                    onClick={() => pollNow(p)}
                    disabled={polling.has(p.id)}
                    className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:bg-white/15 disabled:opacity-50"
                    title="Poll now"
                  >
                    <Download size={14} className={cn(polling.has(p.id) && "animate-pulse")} />
                    {polling.has(p.id) ? "Polling…" : "Poll now"}
                  </button>
                  <button
                    onClick={() => toggle(p)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition",
                      p.auto_poll
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-white/10 text-white/50"
                    )}
                    title="Toggle auto-poll"
                  >
                    <Radio size={14} /> {p.auto_poll ? "On" : "Off"}
                  </button>
                </>
              )}
              <button
                onClick={() => remove(p)}
                className="rounded-full bg-white/10 p-2 text-white/60 transition hover:bg-rose-500/20 hover:text-rose-300"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg bg-white/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/30"
    >
      {options.map(([val, label]) => (
        <option key={val} value={val} className="bg-neutral-800">
          {label}
        </option>
      ))}
    </select>
  );
}
