"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MusicLibrary } from "@/lib/music-client";

// Library scan state, with a manual trigger for admins.
//
// Navidrome rescans on its own schedule (hourly), which is the reason a manual
// trigger is wanted at all: after dropping files in — or after a Grabbit
// download lands — the wait for the next tick is the difference between "it
// worked" and "did it work?".
//
// The status itself is readable by everyone; only the button is admin-gated,
// matching the server (startScan is admin-only in Navidrome too).
interface Status {
  scanning: boolean;
  count: number | null;
  folderCount: number | null;
  lastScan: string | null;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "never";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export default function ScanStatus({
  library,
  isAdmin,
}: {
  library: MusicLibrary;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The count when a scan started, so the finish message can say what changed.
  const countBefore = useRef<number | null>(null);
  const [added, setAdded] = useState<number | null>(null);

  // Every read is also the completion check. Doing this only in the poll loop
  // missed fast scans entirely: a thousand-track library finishes in about a
  // second, so the optimistic `scanning: true` was already replaced by the
  // first refetch, the poll never started, and the result was never reported.
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/music/scan?library=${library}`);
      const d = (await r.json()) as Status & { ok?: boolean };
      if (d.ok === false) return null;
      setStatus(d);
      if (!d.scanning && countBefore.current != null && d.count != null) {
        setAdded(d.count - countBefore.current);
        countBefore.current = null;
        // New tracks only reach the shelves on a refetch.
        router.refresh();
      }
      return d;
    } catch {
      return null;
    }
  }, [library, router]);

  useEffect(() => {
    setAdded(null);
    load();
  }, [load]);

  // Poll only while a scan is actually running — a scan of a thousand files is
  // seconds, and polling an idle server forever would be pure noise.
  useEffect(() => {
    if (!status?.scanning) return;
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [status?.scanning, load]);

  const startScan = useCallback(
    async (full: boolean) => {
      setBusy(true);
      setError(null);
      setAdded(null);
      countBefore.current = status?.count ?? null;
      try {
        const r = await fetch(
          `/api/music/scan?library=${library}${full ? "&full=1" : ""}`,
          { method: "POST" }
        );
        const d = await r.json();
        if (d.ok === false) {
          setError(d.error || "Could not start the scan");
          return;
        }
        // Navidrome reports `scanning` a moment after accepting the call.
        setStatus((s) => (s ? { ...s, scanning: true } : s));
        setTimeout(load, 1200);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [library, status?.count, load]
  );

  if (!status) return null;

  return (
    <div className="mx-4 mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/40">
      <span>
        {status.count ?? 0} songs
        {status.folderCount ? ` · ${status.folderCount} folders` : ""}
      </span>
      <span aria-hidden>·</span>
      <span>
        {status.scanning ? "Scanning…" : `Scanned ${timeAgo(status.lastScan)}`}
      </span>

      {isAdmin && (
        <>
          <button
            onClick={() => startScan(false)}
            disabled={busy || status.scanning}
            className="flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1 transition hover:text-white disabled:opacity-40"
          >
            {busy || status.scanning ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            Scan now
          </button>
          <button
            onClick={() => startScan(true)}
            disabled={busy || status.scanning}
            title="Re-read every file instead of only what changed on disk"
            className="rounded-full border border-white/10 px-2.5 py-1 transition hover:text-white disabled:opacity-40"
          >
            Full scan
          </button>
        </>
      )}

      {added != null && (
        <span className={cn(added > 0 ? "text-emerald-400" : "text-white/40")}>
          {added > 0
            ? `+${added} new`
            : added < 0
              ? `${added} removed`
              : "nothing new"}
        </span>
      )}
      {error && <span className="text-rose-400">{error}</span>}
    </div>
  );
}
