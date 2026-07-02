"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2, ScanSearch, Trash2, Crown } from "lucide-react";
import { cn } from "@/lib/utils";

interface Member {
  short_id: number;
  is_best: boolean;
  caption: string | null;
  profile_name: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  size_bytes: number;
  status: string;
}

interface Group {
  group_key: string;
  channel: "main" | "18plus";
  match_type: "exact" | "perceptual";
  members: Member[];
}

interface ScanState {
  status: "idle" | "running" | "done" | "error";
  scanned: number;
  groups: number;
  finished_at: string | null;
  message: string | null;
}

function fmtSize(bytes: number): string {
  if (!bytes) return "—";
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

function fmtDuration(sec: number | null): string {
  if (!sec || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtRes(w: number | null, h: number | null): string {
  return w && h ? `${w}×${h}` : "unknown";
}

// Admin tool: scan the shorts library for byte-identical or perceptually
// identical clips, then review each group and delete the redundant copies. The
// highest-quality clip in a group is marked to keep and can't be deleted here.
export default function ShortsDuplicates({
  channel,
}: {
  channel: "main" | "18plus";
}) {
  const router = useRouter();
  const [state, setState] = useState<ScanState | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/shorts/duplicates?channel=${channel}`);
      if (!res.ok) return;
      const d = await res.json();
      setState(d.state);
      setGroups(d.groups || []);
      // Default selection: every non-best clip in every group.
      const next = new Set<number>();
      for (const g of d.groups || []) {
        for (const m of g.members) if (!m.is_best) next.add(m.short_id);
      }
      setSelected(next);
      return d.state as ScanState;
    } catch {
      /* ignore — transient */
    }
  }, [channel]);

  useEffect(() => {
    load();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  // Poll while a scan is running, then reload results once it finishes.
  useEffect(() => {
    if (state?.status === "running") {
      if (!pollRef.current) {
        pollRef.current = setInterval(async () => {
          const s = await load();
          if (s && s.status !== "running" && pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }, 3000);
      }
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [state?.status, load]);

  const startScan = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/shorts/duplicates/scan", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setState({
          status: "running",
          scanned: 0,
          groups: 0,
          finished_at: null,
          message: null,
        });
        load();
      } else {
        setMsg(d.error || "Scan failed.");
      }
    } catch {
      setMsg("Scan failed.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: number, isBest: boolean) => {
    if (isBest) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deleteSelected = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (
      !window.confirm(
        `Delete ${ids.length} duplicate clip(s)? The best-quality ones are kept. This removes the files.`
      )
    )
      return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/shorts/duplicates/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shortIds: ids }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg(`Deleted ${d.deleted ?? 0} clip(s).`);
        await load();
        router.refresh();
      } else {
        setMsg(d.error || "Delete failed.");
      }
    } catch {
      setMsg("Delete failed.");
    } finally {
      setBusy(false);
    }
  };

  const running = state?.status === "running";
  const selectedCount = selected.size;

  return (
    <section className="mb-8">
      <h2 className="mb-1 text-lg font-semibold">Duplicates</h2>
      <p className="mb-3 text-sm text-white/50">
        Scan for identical or re-encoded copies of the same clip. The
        highest-quality version (resolution, then bitrate) is kept; you confirm
        which copies to delete.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={startScan}
          disabled={busy || running}
          className="flex w-fit items-center gap-2 rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold transition active:scale-95 hover:bg-white/15 disabled:opacity-50"
        >
          {running ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <ScanSearch size={16} />
          )}
          {running ? "Scanning…" : "Scan duplicates"}
        </button>

        {selectedCount > 0 && (
          <button
            onClick={deleteSelected}
            disabled={busy}
            className="flex w-fit items-center gap-2 rounded-full bg-rose-500/90 px-5 py-2.5 text-sm font-semibold transition active:scale-95 hover:bg-rose-500 disabled:opacity-50"
          >
            <Trash2 size={16} /> Delete {selectedCount} selected
          </button>
        )}
      </div>

      {running && (
        <p className="mt-2 text-xs text-white/50">
          Scanned {state?.scanned ?? 0} clip(s)…
        </p>
      )}
      {state?.status === "error" && (
        <p className="mt-2 text-xs text-rose-300">Scan error: {state.message}</p>
      )}
      {msg && <p className="mt-2 text-xs text-white/60">{msg}</p>}

      {!running && groups.length === 0 && (
        <p className="mt-4 text-sm text-white/40">
          {state?.status === "done"
            ? "No duplicates found."
            : "No scan results yet."}
        </p>
      )}

      <div className="mt-4 space-y-4">
        {groups.map((g) => (
          <div
            key={g.group_key}
            className="rounded-2xl border border-white/10 bg-white/5 p-3"
          >
            <div className="mb-2 flex items-center gap-2 text-xs text-white/50">
              <Copy size={13} />
              <span>{g.members.length} copies</span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 font-medium",
                  g.match_type === "exact"
                    ? "bg-amber-500/20 text-amber-200"
                    : "bg-sky-500/20 text-sky-200"
                )}
              >
                {g.match_type === "exact" ? "Identical file" : "Same clip (re-encoded)"}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {g.members.map((m) => {
                const isSel = selected.has(m.short_id);
                return (
                  <button
                    key={m.short_id}
                    onClick={() => toggle(m.short_id, m.is_best)}
                    className={cn(
                      "relative overflow-hidden rounded-xl border text-left transition",
                      m.is_best
                        ? "border-emerald-400/60 ring-1 ring-emerald-400/40"
                        : isSel
                          ? "border-rose-400/70 ring-1 ring-rose-400/50"
                          : "border-white/10 hover:border-white/30"
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/shorts/${m.short_id}/poster`}
                      alt=""
                      loading="lazy"
                      className="aspect-[9/16] w-full bg-black/40 object-cover"
                    />
                    <span
                      className={cn(
                        "absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        m.is_best
                          ? "bg-emerald-500 text-black"
                          : isSel
                            ? "bg-rose-500 text-white"
                            : "bg-black/60 text-white"
                      )}
                    >
                      {m.is_best ? (
                        <>
                          <Crown size={11} /> Keep
                        </>
                      ) : isSel ? (
                        <>
                          <Trash2 size={11} /> Delete
                        </>
                      ) : (
                        "Keep"
                      )}
                    </span>
                    <div className="space-y-0.5 p-2 text-[11px] leading-tight text-white/70">
                      <p className="font-medium text-white/90">
                        {fmtRes(m.width, m.height)}
                      </p>
                      <p>
                        {fmtSize(m.size_bytes)} · {fmtDuration(m.duration)}
                      </p>
                      {m.profile_name && (
                        <p className="truncate text-white/40">{m.profile_name}</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
