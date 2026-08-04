"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useBackDismiss } from "@/lib/use-back-dismiss";
import { Crown, Trash2, X, ArrowLeftRight, MoveHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CompareItem {
  id: number;
  // Full-size (browser-displayable) URL for this copy.
  src: string;
  isBest: boolean;
  // One-line summary shown on the slider label, e.g. "3024×4032 · 97% match".
  headline: string;
  // Extra metadata lines shown under the slider.
  lines: string[];
}

// Before/after review for a duplicate group: the two copies are stacked in one
// box and a draggable divider wipes between them, so a re-crop, a re-encode or a
// quality difference shows up as movement instead of two pictures the eye has to
// hold side by side. Groups of three or more pick which two copies are compared.
export default function DuplicateCompare({
  title,
  items,
  focusId,
  selected,
  onToggle,
  onClose,
  deleteLabel = "Delete",
}: {
  title: string;
  items: CompareItem[];
  focusId: number;
  selected: Set<number>;
  onToggle: (id: number) => void;
  onClose: () => void;
  deleteLabel?: string;
}) {
  const focusIdx = Math.max(
    0,
    items.findIndex((i) => i.id === focusId)
  );
  // The clicked copy is the one being judged, so it goes on the right (after);
  // the group's suggested best is what it's judged against.
  const bestIdx = Math.max(
    0,
    items.findIndex((i) => i.isBest)
  );
  const [aIdx, setAIdx] = useState(bestIdx);
  const [bIdx, setBIdx] = useState(
    focusIdx !== bestIdx
      ? focusIdx
      : // The best copy was the one clicked: compare it against the next copy.
        items.findIndex((_, i) => i !== bestIdx) === -1
        ? bestIdx
        : items.findIndex((_, i) => i !== bestIdx)
  );
  const [pos, setPos] = useState(50);
  const boxRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useBackDismiss(true, onClose);

  const a = items[aIdx];
  const b = items[bIdx];

  const moveTo = useCallback((clientX: number) => {
    const box = boxRef.current;
    if (!box) return;
    const r = box.getBoundingClientRect();
    const next = ((clientX - r.left) / r.width) * 100;
    setPos(Math.max(0, Math.min(100, next)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const step = (e.shiftKey ? 10 : 2) * (e.key === "ArrowLeft" ? -1 : 1);
        setPos((p) => Math.max(0, Math.min(100, p + step)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const swap = () => {
    setAIdx(bIdx);
    setBIdx(aIdx);
  };

  // In a group of three or more, a chip swaps that copy onto the right side —
  // Swap then moves it left if that's the comparison wanted.
  const pick = (idx: number) => {
    if (idx === aIdx || idx === bIdx) return;
    setBIdx(idx);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95 backdrop-blur-sm">
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="flex items-center gap-1 text-xs text-white/50">
            <MoveHorizontal size={12} /> Drag the divider (or use ← →) to wipe
            between the two copies.
          </p>
        </div>
        <button
          onClick={swap}
          className="ml-auto flex shrink-0 items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold transition active:scale-95 hover:bg-white/20"
        >
          <ArrowLeftRight size={15} /> Swap
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
        <div className="mx-auto max-w-4xl">
          <div
            ref={boxRef}
            onPointerDown={(e) => {
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              moveTo(e.clientX);
            }}
            onPointerMove={(e) => {
              if (dragging.current) moveTo(e.clientX);
            }}
            onPointerUp={() => {
              dragging.current = false;
            }}
            onPointerCancel={() => {
              dragging.current = false;
            }}
            className="relative h-[60vh] w-full cursor-ew-resize touch-none select-none overflow-hidden rounded-2xl bg-black"
          >
            {/* Both copies fill the same box, so equal parts of the frame land
                on the same pixels and the wipe compares like for like. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={a.src}
              alt=""
              draggable={false}
              className="absolute inset-0 h-full w-full object-contain"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={b.src}
              alt=""
              draggable={false}
              style={{ clipPath: `inset(0 0 0 ${pos}%)` }}
              className="absolute inset-0 h-full w-full object-contain"
            />

            <span className="pointer-events-none absolute left-3 top-3 max-w-[45%] truncate rounded-full bg-black/70 px-3 py-1 text-xs font-semibold text-white">
              {a.isBest ? "Keep · " : ""}
              {a.headline}
            </span>
            <span className="pointer-events-none absolute right-3 top-3 max-w-[45%] truncate rounded-full bg-black/70 px-3 py-1 text-xs font-semibold text-white">
              {b.isBest ? "Keep · " : ""}
              {b.headline}
            </span>

            <div
              className="pointer-events-none absolute inset-y-0 w-px bg-white/90"
              style={{ left: `${pos}%` }}
            >
              <span className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white p-1.5 text-black shadow-lg">
                <MoveHorizontal size={16} />
              </span>
            </div>
          </div>

          {items.length > 2 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-white/40">Compare:</span>
              {items.map((it, idx) => {
                const side = idx === aIdx ? "left" : idx === bIdx ? "right" : null;
                return (
                  <button
                    key={it.id}
                    onClick={() => pick(idx)}
                    disabled={!!side}
                    className={cn(
                      "rounded-full px-3 py-1 font-medium transition",
                      side
                        ? "bg-white/20 text-white"
                        : "bg-white/5 text-white/50 hover:bg-white/10"
                    )}
                  >
                    {it.headline}
                    {side ? ` · ${side}` : ""}
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[a, b].map((it, i) => {
              const isSel = selected.has(it.id);
              return (
                <div
                  key={`${i}-${it.id}`}
                  className={cn(
                    "rounded-2xl border p-3 text-xs",
                    isSel
                      ? "border-rose-400/70 bg-rose-500/5"
                      : it.isBest
                        ? "border-emerald-400/60 bg-emerald-500/5"
                        : "border-white/10 bg-white/5"
                  )}
                >
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-white/40">
                    {i === 0 ? "Left" : "Right"}
                  </p>
                  <p className="font-semibold text-white/90">{it.headline}</p>
                  {it.lines.map((line, k) => (
                    <p key={k} className="truncate text-white/50" title={line}>
                      {line}
                    </p>
                  ))}
                  <button
                    onClick={() => onToggle(it.id)}
                    className={cn(
                      "mt-2 inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold transition active:scale-95",
                      isSel
                        ? "bg-rose-500 text-white"
                        : it.isBest
                          ? "bg-emerald-500 text-black"
                          : "bg-white/10 text-white/80 hover:bg-white/20"
                    )}
                  >
                    {isSel ? (
                      <>
                        <Trash2 size={12} /> Marked — {deleteLabel.toLowerCase()}
                      </>
                    ) : it.isBest ? (
                      <>
                        <Crown size={12} /> Keeping (best)
                      </>
                    ) : (
                      "Keeping"
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
