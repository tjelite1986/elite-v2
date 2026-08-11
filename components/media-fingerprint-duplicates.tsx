"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Fingerprint,
  Loader2,
  Palette,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useConfirm } from "@/components/confirm-dialog";
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
  // Which members are ticked for deletion, per group.
  const [selected, setSelected] = useState<Record<string, Set<number>>>({});
  const [busyGroup, setBusyGroup] = useState<string | null>(null);
  const [confirmDialog, confirmAsk] = useConfirm();

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
    setSelected({});
  }, [kind]);

  const groupKey = (g: Group) => g.members.map((m) => m.id).join("-");

  const toggle = (key: string, id: number) =>
    setSelected((prev) => {
      const next = new Set(prev[key] ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, [key]: next };
    });

  // Deleting reaches the filesystem, so it asks first and names the count.
  // The whole group is sent so the server can refuse to empty it.
  const remove = async (group: Group) => {
    const key = groupKey(group);
    const ids = [...(selected[key] ?? [])];
    if (ids.length === 0) return;
    const ok = await confirmAsk({
      title: `Delete ${ids.length} file${ids.length === 1 ? "" : "s"}?`,
      message:
        kind === "short"
          ? "The clips and their posters are removed from disk. This cannot be undone."
          : "The video files are removed from disk. This cannot be undone.",
      confirmLabel: "Delete",
    });
    if (!ok) return;

    setBusyGroup(key);
    setError(null);
    try {
      const res = await fetch("/api/media/duplicates", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          ids,
          groupMembers: group.members.map((m) => m.id),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) {
        setError(d.message || d.error || "Could not delete.");
        return;
      }
      setGroups((gs) =>
        (gs ?? [])
          .map((g) =>
            groupKey(g) === key
              ? { ...g, members: g.members.filter((m) => !ids.includes(m.id)) }
              : g
          )
          .filter((g) => g.members.length > 1)
      );
      setSelected((prev) => ({ ...prev, [key]: new Set() }));
    } catch {
      setError("Could not delete.");
    } finally {
      setBusyGroup(null);
    }
  };

  // "Not a duplicate": records the human judgement so the pair stops being
  // offered on every future scan.
  const dismiss = async (group: Group) => {
    const key = groupKey(group);
    setBusyGroup(key);
    setError(null);
    try {
      const res = await fetch("/api/media/duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, ids: group.members.map((m) => m.id) }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Could not save that.");
        return;
      }
      setGroups((gs) => (gs ?? []).filter((g) => groupKey(g) !== key));
    } catch {
      setError("Could not save that.");
    } finally {
      setBusyGroup(null);
    }
  };

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
                  <label
                    key={m.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs",
                      i === 0 ? "bg-emerald-500/10" : "bg-white/5"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selected[groupKey(group)]?.has(m.id) ?? false}
                      onChange={() => toggle(groupKey(group), m.id)}
                      className="accent-rose-400"
                      aria-label={`Select ${m.label || m.id} for deletion`}
                    />
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
                  </label>
                ))}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => remove(group)}
                  disabled={
                    busyGroup === groupKey(group) ||
                    (selected[groupKey(group)]?.size ?? 0) === 0
                  }
                  className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/90 px-3 py-1 text-xs font-medium text-white transition hover:bg-rose-500 disabled:opacity-40"
                >
                  {busyGroup === groupKey(group) ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Trash2 size={12} />
                  )}
                  Delete selected
                  {(selected[groupKey(group)]?.size ?? 0) > 0
                    ? ` (${selected[groupKey(group)]?.size})`
                    : ""}
                </button>

                <button
                  onClick={() => dismiss(group)}
                  disabled={busyGroup === groupKey(group)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1 text-xs transition hover:bg-white/10 disabled:opacity-40"
                >
                  <Check size={12} />
                  Not a duplicate
                </button>

                <span className="ml-auto text-[11px] text-white/30">
                  tick what to remove — the rest is kept
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      {confirmDialog}
    </section>
  );
}
