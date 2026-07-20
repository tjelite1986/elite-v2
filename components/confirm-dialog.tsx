"use client";

import { useCallback, useRef, useState } from "react";
import { useBackDismiss } from "@/lib/use-back-dismiss";

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
}

// Promise-based confirmation popup — a drop-in replacement for window.confirm
// with the app's look, so every destructive action asks the same way. Usage:
//   const [confirmDialog, confirmAsk] = useConfirm();
//   if (!(await confirmAsk({ title: "Delete this photo?", message: "…" }))) return;
// …and render {confirmDialog} once in the component's JSX.
export function useConfirm(): [
  React.ReactNode,
  (opts: ConfirmOptions) => Promise<boolean>,
] {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const ask = useCallback((o: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      // A second ask while one is open cancels the first.
      resolver.current?.(false);
      resolver.current = resolve;
      setOpts(o);
    });
  }, []);

  const settle = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpts(null);
  }, []);

  const element = (
    <ConfirmDialog
      opts={opts}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );
  return [element, ask];
}

function ConfirmDialog({
  opts,
  onConfirm,
  onCancel,
}: {
  opts: ConfirmOptions | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Device Back dismisses the popup instead of leaving the page.
  useBackDismiss(opts !== null, onCancel);
  if (!opts) return null;
  return (
    // z-[1300]: above lightboxes (z-50) and the floating controls (z-[1100]).
    <div
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/60 p-6"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-neutral-900 p-5 text-white shadow-xl ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-base font-semibold">{opts.title}</p>
        {opts.message && (
          <p className="mt-1 text-sm text-white/60">{opts.message}</p>
        )}
        <div className="mt-4 flex gap-3">
          <button
            onClick={onConfirm}
            className="flex-1 rounded-full bg-red-600 py-2.5 text-sm font-semibold transition active:scale-95"
          >
            {opts.confirmLabel ?? "Delete"}
          </button>
          <button
            onClick={onCancel}
            className="flex-1 rounded-full bg-white/10 py-2.5 text-sm font-semibold transition active:scale-95"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
