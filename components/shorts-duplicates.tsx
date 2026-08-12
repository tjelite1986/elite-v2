"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/confirm-dialog";
import { useBackDismiss } from "@/lib/use-back-dismiss";
import {
  Check,
  Copy,
  Loader2,
  ScanSearch,
  Trash2,
  Crown,
  Play,
  Pause,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
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
  created_at: string;
  source_id: string | null;
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

// "YYYY-MM-DD HH:MM:SS" (UTC in the DB) → local "YYYY-MM-DD".
function fmtAdded(s: string): string {
  const d = new Date(s.replace(" ", "T") + "Z");
  return isNaN(d.getTime()) ? s.slice(0, 10) : d.toLocaleDateString("sv-SE");
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
  // Side-by-side player for one group, so the copies can be watched before
  // anything is deleted.
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    groupKey: string;
    focusId: number;
  } | null>(null);
  const [confirmDialog, confirmAsk] = useConfirm();
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

  // "Not a duplicate": the scan rewrites its table on every run, so this is
  // recorded separately and applied when groups are read. Without it a wrong
  // match is unremovable — the only other way to make it go away is deleting a
  // file you want to keep.
  const dismissGroup = async (g: Group) => {
    setDismissing(g.group_key);
    try {
      const res = await fetch("/api/shorts/duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel,
          shortIds: g.members.map((m) => m.short_id),
        }),
      });
      if (!res.ok) return;
      setGroups((gs) => gs.filter((x) => x.group_key !== g.group_key));
      setPreview((p) => (p?.groupKey === g.group_key ? null : p));
    } catch {
      /* leave the group in place; the next load retries */
    } finally {
      setDismissing(null);
    }
  };

  const deleteSelected = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const ok = await confirmAsk({
      title: `Delete ${ids.length} duplicate clip(s)?`,
      message: "The best-quality ones are kept. This removes the files.",
    });
    if (!ok) return;
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
  // Read the group back out of state so the player closes by itself once a
  // rescan or a delete makes the group go away.
  const previewGroup = preview
    ? groups.find((g) => g.group_key === preview.groupKey)
    : null;

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
              <button
                onClick={() =>
                  setPreview({
                    groupKey: g.group_key,
                    focusId: g.members[0].short_id,
                  })
                }
                className="ml-auto flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 font-medium text-white/80 transition active:scale-95 hover:bg-white/20"
              >
                <Play size={12} /> Watch copies
              </button>
              <button
                onClick={() => dismissGroup(g)}
                disabled={dismissing === g.group_key}
                title="These are different clips — stop showing this group"
                className="flex items-center gap-1 rounded-full border border-white/15 px-2.5 py-1 font-medium text-white/70 transition active:scale-95 hover:bg-white/10 disabled:opacity-50"
              >
                {dismissing === g.group_key ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Check size={12} />
                )}
                Not a duplicate
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {g.members.map((m) => {
                const isSel = selected.has(m.short_id);
                // Compare metadata across the copies: mark the most recently
                // added one (a fresh grabbit download carries the richest
                // title/tags metadata) so it's easy to spot.
                const newest = g.members.every(
                  (o) => o.short_id === m.short_id || o.created_at <= m.created_at
                );
                return (
                  <div
                    key={m.short_id}
                    className={cn(
                      "relative overflow-hidden rounded-xl border text-left transition",
                      m.is_best
                        ? "border-emerald-400/60 ring-1 ring-emerald-400/40"
                        : isSel
                          ? "border-rose-400/70 ring-1 ring-rose-400/50"
                          : "border-white/10 hover:border-white/30"
                    )}
                  >
                    <button
                      onClick={() => toggle(m.short_id, m.is_best)}
                      className="block w-full text-left"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/shorts/${m.short_id}/poster?c=2`}
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
                        <p className={cn(newest ? "text-sky-300" : "text-white/50")}>
                          Added {fmtAdded(m.created_at)}
                          {newest && g.members.length > 1 ? " · newest" : ""}
                        </p>
                        {m.caption ? (
                          // Full title/tags/description from the download —
                          // hover (or long-press) shows the whole text.
                          <p
                            className="line-clamp-3 whitespace-pre-wrap text-white/60"
                            title={m.caption}
                          >
                            {m.caption}
                          </p>
                        ) : (
                          <p className="italic text-white/30">No title</p>
                        )}
                        {m.source_id && (
                          <p className="truncate text-white/30" title={m.source_id}>
                            src: {m.source_id}
                          </p>
                        )}
                        {m.profile_name && (
                          <p className="truncate text-white/40">{m.profile_name}</p>
                        )}
                      </div>
                    </button>
                    {/* Sibling of the select button, not nested inside it:
                        watching a copy must not flip its Keep/Delete state. */}
                    <button
                      onClick={() =>
                        setPreview({
                          groupKey: g.group_key,
                          focusId: m.short_id,
                        })
                      }
                      aria-label="Play this copy"
                      className="absolute right-1.5 top-1.5 rounded-full bg-black/70 p-2 text-white transition active:scale-90 hover:bg-black/90"
                    >
                      <Play size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {previewGroup && preview && (
        <ComparePlayer
          group={previewGroup}
          focusId={preview.focusId}
          selected={selected}
          onToggle={toggle}
          onClose={() => setPreview(null)}
        />
      )}
      {confirmDialog}
    </section>
  );
}

// Watch every copy in one group side by side before deciding what to delete.
// The clips start muted (browsers block audible autoplay anyway) and only one
// can be audible at a time, so "which of these is the good one" is a question
// about picture and length, not a wall of overlapping sound.
function ComparePlayer({
  group,
  focusId,
  selected,
  onToggle,
  onClose,
}: {
  group: Group;
  focusId: number;
  selected: Set<number>;
  onToggle: (id: number, isBest: boolean) => void;
  onClose: () => void;
}) {
  const videos = useRef(new Map<number, HTMLVideoElement>());
  const [playing, setPlaying] = useState(false);
  // Which copy has sound; null = all muted.
  const [soundId, setSoundId] = useState<number | null>(null);

  useBackDismiss(true, onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // React's `muted` prop is unreliable on <video>; set the property directly.
  useEffect(() => {
    for (const [id, el] of videos.current) el.muted = id !== soundId;
  }, [soundId]);

  const register = (id: number) => (el: HTMLVideoElement | null) => {
    if (el) {
      el.muted = id !== soundId;
      videos.current.set(id, el);
    } else {
      videos.current.delete(id);
    }
  };

  const playAll = () => {
    for (const el of videos.current.values()) {
      el.currentTime = 0;
      void el.play().catch(() => {});
    }
    setPlaying(true);
  };

  const pauseAll = () => {
    for (const el of videos.current.values()) el.pause();
    setPlaying(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95 backdrop-blur-sm">
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {group.members.length} copies ·{" "}
            {group.match_type === "exact"
              ? "Identical file"
              : "Same clip (re-encoded)"}
          </p>
          <p className="text-xs text-white/50">
            Watch them, then mark the ones to delete. Nothing is removed until
            you press Delete in the list behind this.
          </p>
        </div>
        <button
          onClick={playing ? pauseAll : playAll}
          className="ml-auto flex shrink-0 items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold transition active:scale-95 hover:bg-white/20"
        >
          {playing ? <Pause size={15} /> : <Play size={15} />}
          {playing ? "Pause all" : "Play all"}
        </button>
        <button
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 rounded-full bg-white/10 p-2 transition active:scale-90 hover:bg-white/20"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div
          className={cn(
            "mx-auto grid max-w-5xl gap-4",
            group.members.length > 1 ? "sm:grid-cols-2" : "max-w-sm"
          )}
        >
          {group.members.map((m) => {
            const isSel = selected.has(m.short_id);
            const audible = soundId === m.short_id;
            return (
              <div
                key={m.short_id}
                className={cn(
                  "overflow-hidden rounded-2xl border bg-white/5",
                  m.is_best
                    ? "border-emerald-400/60"
                    : isSel
                      ? "border-rose-400/70"
                      : "border-white/10"
                )}
              >
                <div className="relative bg-black">
                  <video
                    ref={register(m.short_id)}
                    src={`/api/shorts/${m.short_id}/video`}
                    poster={`/api/shorts/${m.short_id}/poster?c=2`}
                    controls
                    loop
                    playsInline
                    // The one that was clicked loads eagerly; the others wait
                    // for a tap so opening a group isn't a bandwidth spike.
                    preload={m.short_id === focusId ? "auto" : "metadata"}
                    autoPlay={m.short_id === focusId}
                    onPlay={() => setPlaying(true)}
                    className="max-h-[55vh] w-full bg-black object-contain"
                  />
                  <button
                    onClick={() => setSoundId(audible ? null : m.short_id)}
                    aria-label={audible ? "Mute" : "Unmute this copy"}
                    className={cn(
                      "absolute right-2 top-2 rounded-full p-2 text-white transition active:scale-90",
                      audible ? "bg-sky-500" : "bg-black/70 hover:bg-black/90"
                    )}
                  >
                    {audible ? <Volume2 size={15} /> : <VolumeX size={15} />}
                  </button>
                </div>

                <div className="space-y-1 p-3 text-xs text-white/70">
                  <p className="font-semibold text-white/90">
                    {fmtRes(m.width, m.height)} · {fmtSize(m.size_bytes)} ·{" "}
                    {fmtDuration(m.duration)}
                  </p>
                  <p className="text-white/50">Added {fmtAdded(m.created_at)}</p>
                  {m.caption && (
                    <p className="line-clamp-3 whitespace-pre-wrap text-white/60">
                      {m.caption}
                    </p>
                  )}
                  {m.is_best ? (
                    <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-500 px-3 py-1 text-[11px] font-semibold text-black">
                      <Crown size={12} /> Kept — best quality
                    </span>
                  ) : (
                    <button
                      onClick={() => onToggle(m.short_id, m.is_best)}
                      className={cn(
                        "mt-1 inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold transition active:scale-95",
                        isSel
                          ? "bg-rose-500 text-white"
                          : "bg-white/10 text-white/80 hover:bg-white/20"
                      )}
                    >
                      {isSel ? (
                        <>
                          <Trash2 size={12} /> Marked for deletion
                        </>
                      ) : (
                        "Keep this copy"
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
