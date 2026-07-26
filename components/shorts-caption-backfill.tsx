"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Tags, Loader2 } from "lucide-react";

interface CaptionState {
  status: "idle" | "running" | "done" | "error";
  processed: number;
  updated: number;
  total: number;
  message: string | null;
}

// Admin tool: clips grabbed before the grabber carried the source page's title
// and tags have a caption holding nothing but their source link. This re-reads
// that source and writes the real title + hashtags onto the existing rows —
// re-downloading them would only create a second copy. Fires the detached job
// and polls its progress.
export default function ShortsCaptionBackfill({
  channel,
}: {
  channel: "main" | "18plus";
}) {
  const [state, setState] = useState<CaptionState | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/shorts/captions");
      if (!res.ok) return;
      const d = await res.json();
      setState(d.state);
      return d.state as CaptionState;
    } catch {
      /* transient */
    }
  }, []);

  useEffect(() => {
    load();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

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

  const start = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/shorts/captions/scan?channel=${channel}`, {
        method: "POST",
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setState({ status: "running", processed: 0, updated: 0, total: 0, message: null });
        load();
      } else {
        setMsg(d.error || "Failed to start.");
      }
    } catch {
      setMsg("Failed to start.");
    } finally {
      setBusy(false);
    }
  };

  const running = state?.status === "running";

  return (
    <section className="mb-8">
      <h2 className="mb-1 text-lg font-semibold">Captions &amp; tags</h2>
      <p className="mb-3 text-sm text-white/50">
        Older clips show only a source link where their caption should be. This
        re-reads that source page and writes the real title and tags onto them —
        nothing is downloaded again, and captions that already say something are
        left alone. Runs in the background.
      </p>

      <button
        onClick={start}
        disabled={busy || running}
        className="flex w-fit items-center gap-2 rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold transition active:scale-95 hover:bg-white/15 disabled:opacity-50"
      >
        {running ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Tags size={16} />
        )}
        {running ? "Backfilling…" : "Backfill captions"}
      </button>

      {running && (
        <p className="mt-2 text-xs text-white/50">
          {state?.processed ?? 0}
          {state?.total ? `/${state.total}` : ""} album(s) read
          {state?.updated ? `, ${state.updated} caption(s) updated` : ""}…
        </p>
      )}
      {state?.status === "done" && (
        <p className="mt-2 text-xs text-white/60">Done — {state.message}</p>
      )}
      {state?.status === "error" && (
        <p className="mt-2 text-xs text-rose-300">Error: {state.message}</p>
      )}
      {msg && <p className="mt-2 text-xs text-white/60">{msg}</p>}
    </section>
  );
}
