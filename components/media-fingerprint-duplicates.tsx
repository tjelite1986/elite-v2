"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Crown,
  Fingerprint,
  Loader2,
  Palette,
  Pause,
  Play,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/confirm-dialog";
import { useBackDismiss } from "@/lib/use-back-dismiss";

type Kind = "short" | "video";

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
  kind: Kind;
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

// Media URLs differ per kind; nothing else in this view does.
const posterUrl = (kind: Kind, id: number) =>
  kind === "short" ? `/api/shorts/${id}/poster?c=2` : `/api/videos/${id}/poster`;
const videoUrl = (kind: Kind, id: number) =>
  kind === "short" ? `/api/shorts/${id}/video` : `/api/videos/${id}/stream`;

function fmtSize(bytes: number | null): string {
  if (!bytes) return "—";
  const mb = bytes / 1024 ** 2;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

function fmtDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return m > 0 ? `${m}:${String(s % 60).padStart(2, "0")}` : `${s}s`;
}

function fmtRes(w: number | null, h: number | null): string {
  return w && h ? `${w}×${h}` : "—";
}

function fmtAdded(iso: string): string {
  const then = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return then.toISOString().slice(0, 10);
}

const groupKeyOf = (g: Group) => g.members.map((m) => m.id).join("-");

// Redundant copies across every listed group — the best copy of each group
// (highest resolution, file size breaking ties) sorts first and is the keeper,
// so everything after the first counts.
const discardableCount = (groups: Group[]) =>
  groups.reduce((n, g) => n + Math.max(0, g.members.length - 1), 0);

// Duplicate review based on whole-clip fingerprints. Complements the existing
// exact/per-frame scan: this one catches the same clip re-encoded, rescaled or
// watermarked, because it compares how the video progresses rather than how any
// single frame looks.
export default function MediaFingerprintDuplicates({
  initialKind = "short",
}: {
  initialKind?: Kind;
}) {
  // One panel covers both media kinds: the fingerprint run already does shorts
  // and library videos together, and the settings page has no video section to
  // hang a second copy of this on.
  const [kind, setKind] = useState<Kind>(initialKind);
  const [state, setState] = useState<State | null>(null);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [recolored, setRecolored] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ticked for deletion, keyed by group.
  const [selected, setSelected] = useState<Record<string, Set<number>>>({});
  const [busyGroup, setBusyGroup] = useState<string | null>(null);
  // "Discard all" runs one request per group, so it needs its own busy flag and
  // a progress line separate from the per-group state.
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ groupKey: string } | null>(null);
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

  useEffect(() => {
    setGroups(null);
    setSelected({});
    setPreview(null);
  }, [kind]);

  // The first member is the best copy — highest resolution, file size breaking
  // ties — so the suggested keeper cannot be ticked. Everything else is the
  // reviewer's call.
  const toggle = (key: string, id: number, isBest: boolean) => {
    if (isBest) return;
    setSelected((prev) => {
      const next = new Set(prev[key] ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, [key]: next };
    });
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

  const remove = async (group: Group) => {
    const key = groupKeyOf(group);
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
            groupKeyOf(g) === key
              ? { ...g, members: g.members.filter((m) => !ids.includes(m.id)) }
              : g
          )
          .filter((g) => g.members.length > 1)
      );
      setSelected((prev) => ({ ...prev, [key]: new Set() }));
      setPreview(null);
    } catch {
      setError("Could not delete.");
    } finally {
      setBusyGroup(null);
    }
  };

  // One-click cleanup: keep the best copy of every group and delete the rest.
  // The delete endpoint validates one group at a time (it must see the whole
  // group to refuse wiping it), so this walks the groups in sequence.
  const discardAll = async () => {
    const list = groups ?? [];
    const total = discardableCount(list);
    if (total === 0 || bulkBusy) return;
    const ok = await confirmAsk({
      title: `Discard ${total} duplicate file${total === 1 ? "" : "s"}?`,
      message:
        kind === "short"
          ? "The highest-resolution copy in each group is kept; the rest and their posters are removed from disk. This cannot be undone."
          : "The highest-resolution copy in each group is kept; the rest are removed from disk. This cannot be undone.",
      confirmLabel: "Discard all",
    });
    if (!ok) return;

    setBulkBusy(true);
    setError(null);
    setBulkMsg(null);
    let deleted = 0;
    let failure: string | null = null;
    try {
      for (const group of list) {
        const ids = group.members.slice(1).map((m) => m.id);
        if (ids.length === 0) continue;
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
          failure = d.message || d.error || "Could not delete.";
          break;
        }
        deleted += d.deleted ?? 0;
        setBulkMsg(`Discarding… ${deleted}/${total}`);
      }
    } catch {
      failure = "Could not delete.";
    }
    if (failure) {
      setError(`${failure} ${deleted} file(s) were deleted before the error.`);
      setBulkMsg(null);
    } else {
      setBulkMsg(
        `Discarded ${deleted} duplicate file${deleted === 1 ? "" : "s"}.`
      );
    }
    setSelected({});
    setPreview(null);
    await loadGroups();
    setBulkBusy(false);
  };

  // "Not a duplicate": records the human judgement so the pair stops being
  // offered on every future scan.
  const dismiss = async (group: Group) => {
    const key = groupKeyOf(group);
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
      setGroups((gs) => (gs ?? []).filter((g) => groupKeyOf(g) !== key));
      setPreview(null);
    } catch {
      setError("Could not save that.");
    } finally {
      setBusyGroup(null);
    }
  };

  const pending = state ? state.pending.shorts + state.pending.videos : 0;
  const previewGroup = preview
    ? (groups ?? []).find((g) => groupKeyOf(g) === preview.groupKey)
    : null;

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
              kind === k
                ? "bg-white text-black"
                : "text-white/60 hover:text-white"
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
                state.lastRun.skipped
                  ? `, ${state.lastRun.skipped} unreadable`
                  : ""
              }`
            : ""}
        </p>
      )}

      {error && <p className="mb-2 text-xs text-rose-400">{error}</p>}
      {bulkMsg && <p className="mb-2 text-xs text-white/60">{bulkMsg}</p>}

      {groups && groups.length === 0 && (
        <p className="text-xs text-white/40">
          No duplicate groups found
          {recolored ? "" : " (recoloured copies are hidden)"}.
        </p>
      )}

      {groups && groups.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-white/45">
              {groups.length} group{groups.length === 1 ? "" : "s"} · the
              highest-resolution copy in each is kept
            </p>
            {discardableCount(groups) > 0 && (
              <button
                onClick={discardAll}
                disabled={bulkBusy || busyGroup !== null}
                className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-rose-400/50 px-3.5 py-1.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/15 disabled:opacity-50"
              >
                {bulkBusy ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Trash2 size={13} />
                )}
                Discard all duplicates ({discardableCount(groups)})
              </button>
            )}
          </div>

          {groups.map((group) => {
            const key = groupKeyOf(group);
            const picked = selected[key] ?? new Set<number>();
            const busy = busyGroup === key || bulkBusy;

            return (
              <div
                key={key}
                className="rounded-xl border border-white/10 bg-black/20 p-3"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-white/70">
                    {Math.round(group.minSimilarity * 100)}% match
                  </span>
                  {group.recoloredOnly && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-300">
                      <Palette size={10} />
                      same footage, different colour
                    </span>
                  )}
                  <button
                    onClick={() => setPreview({ groupKey: key })}
                    className="ml-auto flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 font-medium text-white/80 transition hover:bg-white/20 active:scale-95"
                  >
                    <Play size={12} /> Watch copies
                  </button>
                </div>

                <div
                  className={cn(
                    "grid gap-2",
                    kind === "short"
                      ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4"
                      : "grid-cols-1 sm:grid-cols-2 md:grid-cols-3"
                  )}
                >
                  {group.members.map((m, i) => {
                    const isBest = i === 0;
                    const isSel = picked.has(m.id);
                    return (
                      <div
                        key={m.id}
                        className={cn(
                          "relative overflow-hidden rounded-xl border text-left transition",
                          isBest
                            ? "border-emerald-400/60 ring-1 ring-emerald-400/40"
                            : isSel
                              ? "border-rose-400/70 ring-1 ring-rose-400/50"
                              : "border-white/10 hover:border-white/30"
                        )}
                      >
                        <button
                          onClick={() => toggle(key, m.id, isBest)}
                          className="block w-full text-left"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={posterUrl(kind, m.id)}
                            alt=""
                            loading="lazy"
                            className={cn(
                              "w-full bg-black/40 object-cover",
                              kind === "short" ? "aspect-[9/16]" : "aspect-video"
                            )}
                          />
                          <span
                            className={cn(
                              "absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                              isBest
                                ? "bg-emerald-500 text-black"
                                : isSel
                                  ? "bg-rose-500 text-white"
                                  : "bg-black/60 text-white"
                            )}
                          >
                            {isBest ? (
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
                            <p className="text-white/40">
                              Added {fmtAdded(m.created_at)}
                            </p>
                            {m.label ? (
                              <p
                                className="line-clamp-3 whitespace-pre-wrap text-white/60"
                                title={m.label}
                              >
                                {m.label}
                              </p>
                            ) : (
                              <p className="italic text-white/30">No title</p>
                            )}
                          </div>
                        </button>

                        {/* Sibling of the select button, not nested inside it:
                            watching a copy must not flip its Keep/Delete state. */}
                        <button
                          onClick={() => setPreview({ groupKey: key })}
                          aria-label="Play this copy"
                          className="absolute right-1.5 top-1.5 rounded-full bg-black/70 p-2 text-white transition hover:bg-black/90 active:scale-90"
                        >
                          <Play size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => remove(group)}
                    disabled={busy || picked.size === 0}
                    className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/90 px-3 py-1 text-xs font-medium text-white transition hover:bg-rose-500 disabled:opacity-40"
                  >
                    {busy ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Trash2 size={12} />
                    )}
                    Delete selected
                    {picked.size > 0 ? ` (${picked.size})` : ""}
                  </button>

                  <button
                    onClick={() => dismiss(group)}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1 text-xs transition hover:bg-white/10 disabled:opacity-40"
                  >
                    <Check size={12} />
                    Not a duplicate
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {previewGroup && preview && (
        <ComparePlayer
          kind={kind}
          group={previewGroup}
          selected={selected[preview.groupKey] ?? new Set()}
          onToggle={(id, isBest) => toggle(preview.groupKey, id, isBest)}
          onClose={() => setPreview(null)}
        />
      )}

      {confirmDialog}
    </section>
  );
}

// Watch every copy in one group side by side before deciding what to delete.
// They start muted (browsers block audible autoplay anyway) and only one can be
// audible at a time, so "which of these is the good one" stays a question about
// picture and length rather than a wall of overlapping sound.
function ComparePlayer({
  kind,
  group,
  selected,
  onToggle,
  onClose,
}: {
  kind: Kind;
  group: Group;
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
            {Math.round(group.minSimilarity * 100)}% match
            {group.recoloredOnly ? " · different colour" : ""}
          </p>
          <p className="text-xs text-white/50">
            Watch them, then mark the ones to delete. Nothing is removed until
            you press Delete in the list behind this.
          </p>
        </div>
        <button
          onClick={playing ? pauseAll : playAll}
          className="ml-auto flex shrink-0 items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold transition hover:bg-white/20 active:scale-95"
        >
          {playing ? <Pause size={15} /> : <Play size={15} />}
          {playing ? "Pause all" : "Play all"}
        </button>
        <button
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 rounded-full bg-white/10 p-2 transition hover:bg-white/20 active:scale-90"
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
          {group.members.map((m, i) => {
            const isBest = i === 0;
            const isSel = selected.has(m.id);
            const audible = soundId === m.id;
            return (
              <div
                key={m.id}
                className={cn(
                  "overflow-hidden rounded-2xl border bg-white/5",
                  isBest
                    ? "border-emerald-400/60"
                    : isSel
                      ? "border-rose-400/70"
                      : "border-white/10"
                )}
              >
                <div className="relative bg-black">
                  <video
                    ref={register(m.id)}
                    src={videoUrl(kind, m.id)}
                    poster={posterUrl(kind, m.id)}
                    controls
                    loop
                    playsInline
                    preload="metadata"
                    className={cn(
                      "w-full bg-black",
                      kind === "short" ? "max-h-[55vh]" : "aspect-video"
                    )}
                  />
                  <button
                    onClick={() => setSoundId(audible ? null : m.id)}
                    className={cn(
                      "absolute right-2 top-2 rounded-full px-2.5 py-1 text-[11px] font-semibold transition",
                      audible
                        ? "bg-white text-black"
                        : "bg-black/70 text-white hover:bg-black/90"
                    )}
                  >
                    {audible ? "Sound on" : "Listen"}
                  </button>
                </div>

                <div className="flex items-center gap-2 p-3 text-xs">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-white/90">
                      {m.label || "(no title)"}
                    </p>
                    <p className="text-white/50">
                      {fmtRes(m.width, m.height)} · {fmtSize(m.size_bytes)} ·{" "}
                      {fmtDuration(m.duration)}
                    </p>
                  </div>
                  <button
                    onClick={() => onToggle(m.id, isBest)}
                    disabled={isBest}
                    className={cn(
                      "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition active:scale-95",
                      isBest
                        ? "bg-emerald-500/20 text-emerald-300"
                        : isSel
                          ? "bg-rose-500 text-white"
                          : "bg-white/10 text-white/80 hover:bg-white/20"
                    )}
                  >
                    {isBest ? "Keep" : isSel ? "Delete" : "Mark delete"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
