"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Wand2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBackDismiss } from "@/lib/use-back-dismiss";

// The conversion backlog, one row per file, each startable on its own. An
// encode of a feature-length film runs for hours on this machine, so starting
// the whole queue is a decision — not something a single button should do by
// default.

interface QueueItem {
  id: number;
  title: string;
  folder: string | null;
  storage_key: string;
  size_bytes: number;
  duration: number | null;
  video_codec: string | null;
  audio_codec: string | null;
  transcode_status: string | null;
  transcode_error: string | null;
}

function gb(bytes: number): string {
  return bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(2)} GB`
    : `${Math.round(bytes / 1e6)} MB`;
}

function minutes(seconds: number | null): string | null {
  return seconds ? `${Math.round(seconds / 60)} min` : null;
}

export default function TranscodeQueue({
  channel,
  onClose,
  onChanged,
}: {
  channel: "main" | "adults";
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [starting, setStarting] = useState<number | null>(null);

  useBackDismiss(true, onClose);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/videos/transcode?list=1&channel=${channel}`
      );
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.items || []);
      setRunning(Boolean(data.running));
      setCurrentKey(data.currentKey ?? null);
      if (data.lastRun?.message) setNote(data.lastRun.message);
    } finally {
      setLoading(false);
    }
  }, [channel]);

  useEffect(() => {
    void load();
    // An encode takes minutes to hours, so this only has to be timely enough to
    // show that something started and when it finished.
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, [load]);

  const convert = async (id?: number) => {
    setStarting(id ?? -1);
    setNote(null);
    try {
      const res = await fetch(
        `/api/videos/transcode${id ? `?id=${id}` : ""}`,
        { method: "POST" }
      );
      const data = await res.json().catch(() => ({}));
      setNote(data.message || data.error || "Started.");
      if (data.started) setRunning(true);
      onChanged?.();
    } catch {
      setNote("Could not reach the server.");
    } finally {
      setStarting(null);
      await load();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-end justify-center bg-black/70 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[85dvh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-neutral-900 p-4 text-white ring-1 ring-white/10 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center gap-2">
          <h2 className="flex-1 text-base font-semibold">Needs converting</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-white/50 transition hover:bg-white/10 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>
        <p className="mb-3 text-xs text-white/40">
          These files are in a container or codec no browser plays. Converting
          one takes minutes to hours on this machine, and the original is
          replaced once the result is verified.
        </p>

        {note && (
          <p className="mb-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70">
            {note}
          </p>
        )}

        {loading ? (
          <p className="py-8 text-center text-sm text-white/40">
            <Loader2 size={16} className="mx-auto animate-spin" />
          </p>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-white/40">
            Everything here plays as it is.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {items.map((item) => {
              const isCurrent = running && currentKey === item.storage_key;
              const failed = item.transcode_status === "failed";
              return (
                <li
                  key={item.id}
                  className={cn(
                    "flex items-center gap-3 rounded-xl bg-white/[0.04] p-2.5",
                    isCurrent && "ring-1 ring-amber-400/40"
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{item.title}</span>
                    <span className="block truncate text-xs text-white/45">
                      {[
                        item.folder,
                        gb(item.size_bytes),
                        minutes(item.duration),
                        [item.video_codec, item.audio_codec]
                          .filter(Boolean)
                          .join("/"),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {failed && (
                      <span className="mt-1 flex items-start gap-1 text-[11px] text-red-300/80">
                        <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                        <span className="line-clamp-2">
                          {item.transcode_error || "Conversion failed."}
                        </span>
                      </span>
                    )}
                  </span>
                  {isCurrent ? (
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-400/15 px-3 py-1.5 text-xs text-amber-200">
                      <Loader2 size={13} className="animate-spin" />
                      Converting
                    </span>
                  ) : (
                    <button
                      onClick={() => convert(item.id)}
                      disabled={running || starting !== null}
                      title={
                        running
                          ? "Another conversion is running"
                          : "Convert this one file"
                      }
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-xs transition hover:bg-white/10 disabled:opacity-40"
                    >
                      {starting === item.id ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Wand2 size={13} />
                      )}
                      {failed ? "Retry" : "Convert"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-white/40">
            {items.length} file{items.length === 1 ? "" : "s"}
            {running ? " · a conversion is running" : ""}
          </span>
          <button
            onClick={() => convert()}
            disabled={running || starting !== null || items.length === 0}
            title="Work through the whole backlog, smallest first"
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 px-3 py-1.5 text-xs font-medium text-amber-200 transition hover:bg-amber-400/10 disabled:opacity-40"
          >
            {starting === -1 ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Wand2 size={13} />
            )}
            Convert all
          </button>
        </div>
      </div>
    </div>
  );
}
