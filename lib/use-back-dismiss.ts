"use client";

import { useEffect, useRef } from "react";

// Makes the device/browser Back button dismiss an in-app overlay or drill-in
// view (a fullscreen lightbox, a bottom sheet, an open messenger conversation)
// instead of leaving the current page. Without this, the back button pops the
// page out of history entirely — e.g. tapping Back inside a messenger
// conversation jumps all the way to the dashboard instead of the conversation
// list.
//
// A module-level stack lets nested overlays (an open conversation with a media
// viewer on top of it) unwind one level per Back press, newest first.

type Entry = { close: () => void };

const stack: Entry[] = [];
// Number of upcoming popstate events that were triggered by our own
// history.back() (UI-driven close) and must NOT dismiss the next overlay.
let ignorePops = 0;
let initialized = false;

function handlePop() {
  if (ignorePops > 0) {
    ignorePops--;
    return;
  }
  const entry = stack.pop();
  if (entry) entry.close();
}

function ensureInit() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  window.addEventListener("popstate", handlePop);
}

export function useBackDismiss(open: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    ensureInit();

    const entry: Entry = { close: () => onCloseRef.current() };
    stack.push(entry);
    window.history.pushState({ __backDismiss: true }, "");

    return () => {
      const idx = stack.lastIndexOf(entry);
      if (idx === -1) {
        // Already removed by a Back press — history is in sync, nothing to do.
        return;
      }
      stack.splice(idx, 1);
      // Closed via the UI (Escape, X, backdrop, selecting another item). Pop the
      // history entry we added so it doesn't linger. Only touch history when our
      // entry sat on top (normal LIFO close) and we haven't navigated away
      // (our sentinel is still the current state).
      if (
        idx === stack.length &&
        (window.history.state as { __backDismiss?: boolean } | null)
          ?.__backDismiss
      ) {
        ignorePops++;
        window.history.back();
      }
    };
  }, [open]);
}
