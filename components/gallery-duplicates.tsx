"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2, ScanSearch, Trash2, Crown, Ban } from "lucide-react";
import { cn } from "@/lib/utils";

interface Member {
  item_id: number;
  user_id: number;
  is_best: boolean;
  distance: number;
  width: number | null;
  height: number | null;
  owner_name: string | null;
}

interface Group {
  group_key: string;
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

function fmtRes(w: number | null, h: number | null): string {
  return w && h ? `${w}×${h}` : "okänd";
}

// dHash is 64-bit, so similarity = 1 - distance/64.
function fmtSimilarity(distance: number): string {
  return `${Math.max(0, Math.round((1 - distance / 64) * 100))}% match`;
}

// Admin tool: scan the gallery library for byte-identical or perceptually
// identical images, then review each group and trash the redundant copies. The
// highest-quality image is suggested to keep, but any image can be selected for
// removal (a group is never wiped whole — the best is auto-kept). Removed items
// go to the gallery trash, so the owner can still restore them. Use "Not
// duplicates" to dismiss a false positive (e.g. B&W vs colour, eyes open/closed)
// so it never reappears.
export default function GalleryDuplicates() {
  const router = useRouter();
  const [state, setState] = useState<ScanState | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/gallery/duplicates");
      if (!res.ok) return;
      const d = await res.json();
      setState(d.state);
      setGroups(d.groups || []);
      // Default selection: every non-best image in every group.
      const next = new Set<number>();
      for (const g of d.groups || []) {
        for (const m of g.members) if (!m.is_best) next.add(m.item_id);
      }
      setSelected(next);
      return d.state as ScanState;
    } catch {
      /* ignore — transient */
    }
  }, []);

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
      const res = await fetch("/api/gallery/duplicates/scan", { method: "POST" });
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

  // Any image can be toggled, including the suggested best.
  const toggle = (id: number) => {
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
        `Flytta ${ids.length} bild(er) till papperskorgen? Om en hel grupp markeras behålls dess bästa automatiskt.`
      )
    )
      return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/gallery/duplicates/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds: ids }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        const kept = d.keptBest
          ? ` (${d.keptBest} bästa behölls automatiskt)`
          : "";
        setMsg(`Flyttade ${d.deleted ?? 0} bild(er) till papperskorgen${kept}.`);
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

  // Dismiss a false-positive group so it never reappears in future scans.
  const ignoreGroup = async (g: Group) => {
    const ids = g.members.map((m) => m.item_id);
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/gallery/duplicates/ignore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds: ids }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setGroups((prev) => prev.filter((x) => x.group_key !== g.group_key));
        setSelected((prev) => {
          const next = new Set(prev);
          for (const id of ids) next.delete(id);
          return next;
        });
        setMsg("Markerade som inte dubbletter.");
      } else {
        setMsg(d.error || "Failed.");
      }
    } catch {
      setMsg("Failed.");
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
        Scan for identical or re-cropped copies of the same photo within each
        person&apos;s gallery. The highest-quality version (resolution, then file
        size) is suggested to keep — but you can pick any copy to remove, or hit{" "}
        <span className="text-white/70">Not duplicates</span> to dismiss a false
        match for good. Removed copies go to the owner&apos;s trash.
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
            <Trash2 size={16} /> Trash {selectedCount} selected
          </button>
        )}
      </div>

      {running && (
        <p className="mt-2 text-xs text-white/50">
          Scanned {state?.scanned ?? 0} image(s)…
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
                {g.match_type === "exact"
                  ? "Identical file"
                  : "Same photo (re-cropped)"}
              </span>
              <button
                onClick={() => ignoreGroup(g)}
                disabled={busy}
                className="ml-auto flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-0.5 font-medium text-white/70 transition hover:bg-white/15 disabled:opacity-50"
              >
                <Ban size={12} /> Not duplicates
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {g.members.map((m) => {
                const isSel = selected.has(m.item_id);
                return (
                  <button
                    key={m.item_id}
                    onClick={() => toggle(m.item_id)}
                    className={cn(
                      "relative overflow-hidden rounded-xl border text-left transition",
                      isSel
                        ? "border-rose-400/70 ring-1 ring-rose-400/50"
                        : m.is_best
                          ? "border-emerald-400/60 ring-1 ring-emerald-400/40"
                          : "border-white/10 hover:border-white/30"
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/gallery/${m.item_id}/media?variant=thumb`}
                      alt=""
                      loading="lazy"
                      className="aspect-square w-full bg-black/40 object-cover"
                    />
                    <span
                      className={cn(
                        "absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        isSel
                          ? "bg-rose-500 text-white"
                          : m.is_best
                            ? "bg-emerald-500 text-black"
                            : "bg-black/60 text-white"
                      )}
                    >
                      {isSel ? (
                        <>
                          <Trash2 size={11} /> Trash
                        </>
                      ) : m.is_best ? (
                        <>
                          <Crown size={11} /> Keep
                        </>
                      ) : (
                        "Keep"
                      )}
                    </span>
                    <div className="space-y-0.5 p-2 text-[11px] leading-tight text-white/70">
                      <p className="font-medium text-white/90">
                        {fmtRes(m.width, m.height)}
                        {!m.is_best && g.match_type === "perceptual" && (
                          <span className="ml-1 font-normal text-white/40">
                            · {fmtSimilarity(m.distance)}
                          </span>
                        )}
                      </p>
                      {m.owner_name && (
                        <p className="truncate text-white/40">
                          @{m.owner_name}
                        </p>
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
