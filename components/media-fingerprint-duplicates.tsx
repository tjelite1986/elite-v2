"use client";

import { useCallback, useEffect, useState } from "react";
import { Fingerprint, Loader2, Palette, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface Member {
  id: number;
  channel: string;
  label: string | null;
  duration: number | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  poster_key: string | null;
  created_at: string;
}

interface Group {
  kind: "short" | "video";
  members: Member[];
  minSimilarity: number;
  recoloredOnly: boolean;
}

interface State {
  running: boolean;
  pending: { shorts: number; videos: number };
  stored: number;
  lastRun: {
    finishedAt: string;
    fingerprinted: number;
    skipped: number;
  } | null;
}

function human(bytes: number | null): string {
  if (!bytes) return "—";
  const mb = bytes / 1024 ** 2;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

function clock(seconds: number | null): string {
  if (!seconds) return "—";
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}:${String(s % 60).padStart(2, "0")}` : `${s}s`;
}

// Duplicate review based on whole-clip fingerprints. Complements the existing
// exact/per-frame scan: this one catches the same clip re-encoded, rescaled or
// watermarked, because it compares how the video progresses rather than how
// any single frame looks.
export default function MediaFingerprintDuplicates({
  initialKind = "short",
}: {
  initialKind?: "short" | "video";
}) {
  // One panel covers both media kinds: the fingerprint run already does shorts
  // and library videos together, and the settings page has no video section to
  // hang a second copy of this on.
  const [kind, setKind] = useState<"short" | "video">(initialKind);
  const [state, setState] = useState<State | null>(null);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [recolored, setRecolored] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    const s = await fetch("/api/media/fingerprint")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (s) setState(s);
    return s as State | null;
  }, []);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await fetch(
        `/api/media/duplicates?kind=${kind}${recolored ? "&recolored=1" : ""}`
      ).then((r) => (r.ok ? r.json() : null));
      if (!d) {
        setError("Could not load duplicates.");
        return;
      }
      setGroups(d.groups ?? []);
    } catch {
      setError("Could not load duplicates.");
    } finally {
      setLoading(false);
    }
  }, [kind, recolored]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  // Switching kind invalidates the listed groups.
  useEffect(() => {
    setGroups(null);
  }, [kind]);

  // Fingerprinting is CPU work on the server, so the button starts it and the
  // page polls. Bounded: a stuck run must not spin here forever.
  const run = async () => {
    setError(null);
    const res = await fetch("/api/media/fingerprint", { method: "POST" }).catch(
      () => null
    );
    if (!res?.ok) {
      setError("Could not start.");
      return;
    }
    setState((s) => (s ? { ...s, running: true } : s));
    for (let i = 0; i < 240; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const s = await loadState();
      if (s && !s.running) break;
    }
    void loadGroups();
  };

  const pending = state ? state.pending.shorts + state.pending.videos : 0;

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <Fingerprint size={15} />
        Duplicates by clip fingerprint
      </h3>
      <p className="mb-3 text-xs text-white/45">
        Compares how a clip progresses across sixteen sampled frames, so a
        re-encoded, rescaled or watermarked copy still matches. Costs CPU only —
        no API calls.
      </p>

      <div className="mb-3 inline-flex rounded-full bg-white/5 p-0.5 text-xs">
        {(["short", "video"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={cn(
              "rounded-full px-3 py-1 transition",
              kind === k ? "bg-white text-black" : "text-white/60 hover:text-white"
            )}
          >
            {k === "short" ? "Shorts" : "Videos"}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          onClick={run}
          disabled={state?.running || pending === 0}
          className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-xs font-medium text-black transition hover:bg-white/90 disabled:opacity-50"
        >
          {state?.running ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Fingerprint size={13} />
          )}
          {state?.running
            ? "Fingerprinting…"
            : pending === 0
              ? "All fingerprinted"
              : `Fingerprint ${pending} item${pending === 1 ? "" : "s"}`}
        </button>

        <button
          onClick={loadGroups}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3.5 py-1.5 text-xs transition hover:bg-white/10 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <RefreshCw size={13} />
          )}
          Find duplicates
        </button>

        <label className="ml-auto inline-flex cursor-pointer items-center gap-1.5 text-xs text-white/50">
          <input
            type="checkbox"
            checked={recolored}
            onChange={(e) => setRecolored(e.target.checked)}
            className="accent-white"
          />
          <Palette size={12} />
          include recoloured
        </label>
      </div>

      {state && (
        <p className="mb-3 text-[11px] text-white/35">
          {state.stored} fingerprinted · {pending} to go
          {state.lastRun
            ? ` · last run: +${state.lastRun.fingerprinted}${
                state.lastRun.skipped ? `, ${state.lastRun.skipped} unreadable` : ""
              }`
            : ""}
        </p>
      )}

      {error && <p className="mb-2 text-xs text-rose-400">{error}</p>}

      {groups && groups.length === 0 && (
        <p className="text-xs text-white/40">
          No duplicate groups found{recolored ? "" : " (recoloured copies are hidden)"}.
        </p>
      )}

      {groups && groups.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-white/45">
            {groups.length} group{groups.length === 1 ? "" : "s"} · largest file
            listed first
          </p>
          {groups.map((group) => (
            <div
              key={group.members.map((m) => m.id).join("-")}
              className="rounded-xl border border-white/10 bg-black/20 p-3"
            >
              <div className="mb-2 flex items-center gap-2 text-[11px]">
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-white/60">
                  {Math.round(group.minSimilarity * 100)}% match
                </span>
                {group.recoloredOnly && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-300">
                    <Palette size={10} />
                    same footage, different colour
                  </span>
                )}
              </div>

              <div className="space-y-1.5">
                {group.members.map((m, i) => (
                  <div
                    key={m.id}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs",
                      i === 0 ? "bg-emerald-500/10" : "bg-white/5"
                    )}
                  >
                    <span className="w-10 shrink-0 text-white/35">#{m.id}</span>
                    <span className="min-w-0 flex-1 truncate text-white/75">
                      {m.label || "(no title)"}
                    </span>
                    <span className="shrink-0 text-white/45">
                      {m.width && m.height ? `${m.width}×${m.height}` : "—"}
                    </span>
                    <span className="w-14 shrink-0 text-right text-white/45">
                      {clock(m.duration)}
                    </span>
                    <span className="w-16 shrink-0 text-right text-white/45">
                      {human(m.size_bytes)}
                    </span>
                    {i === 0 && (
                      <span className="shrink-0 rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300">
                        best
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
