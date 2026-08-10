"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Check,
  Download,
  FileVideo2,
  FolderOpen,
  Loader2,
  Pencil,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import VideoPlayer, { formatTime } from "@/components/video-player";
import VideoCard, {
  relativeDate,
  viewLabel,
  type VideoCardData,
} from "@/components/video-card";
import { useConfirm } from "@/components/confirm-dialog";
import VideoMetadataPanel, {
  type ScenePerformer,
  type VideoMetadata,
} from "@/components/video-metadata-panel";

export interface WatchVideo extends VideoCardData {
  channel: "main" | "adults";
  description: string | null;
  storage_key: string;
  storyboard_key: string | null;
  storyboard_cols: number | null;
  storyboard_rows: number | null;
  storyboard_interval: number | null;
  storyboard_tile_w: number | null;
  storyboard_tile_h: number | null;
  width: number | null;
  height: number | null;
  size_bytes: number | null;
  position: number;
  percent: number;
  likes: number;
  liked: number;
  playable: number;
  transcode_status: "pending" | "done" | "failed" | null;
  transcode_error: string | null;
  video_codec: string | null;
  audio_codec: string | null;
  metadata?: VideoMetadata | null;
  cast?: ScenePerformer[];
}

function formatSize(bytes: number | null): string | null {
  if (!bytes) return null;
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

// The watch page: player plus the YouTube-style info block and an up-next rail.
// Layout is single-column on phones and player + rail on wide screens; theater
// mode collapses the rail below the player.
export default function VideoWatch({
  video: initial,
  related,
  basePath,
  isAdmin,
}: {
  video: WatchVideo;
  related: VideoCardData[];
  basePath: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [video, setVideo] = useState(initial);
  const [theater, setTheater] = useState(false);
  const [autoplay, setAutoplay] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(initial.title);
  const [descDraft, setDescDraft] = useState(initial.description ?? "");
  const [saving, setSaving] = useState(false);
  const [playerKey, setPlayerKey] = useState(0);
  // Chapter chips live in the metadata panel but drive the player; a nonce lets
  // the same timestamp be requested twice in a row.
  const [seekRequest, setSeekRequest] = useState<{ time: number; nonce: number }>();
  const [confirmDialog, confirmAsk] = useConfirm();
  const [resumeAt, setResumeAt] = useState(
    initial.percent < 95 ? initial.position : 0
  );
  const lastSent = useRef(0);

  // A different video id means a different row — reset the local view state.
  useEffect(() => {
    setVideo(initial);
    setTitleDraft(initial.title);
    setDescDraft(initial.description ?? "");
    setResumeAt(initial.percent < 95 ? initial.position : 0);
    setEditing(false);
    setExpanded(false);
  }, [initial]);

  useEffect(() => {
    try {
      setTheater(localStorage.getItem("videos_theater") === "1");
      setAutoplay(localStorage.getItem("videos_autoplay") !== "0");
    } catch {
      /* defaults are fine */
    }
  }, []);

  const toggleTheater = () => {
    setTheater((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("videos_theater", next ? "1" : "0");
      } catch {
        /* non-persistent is fine */
      }
      return next;
    });
  };

  const toggleAutoplay = () => {
    setAutoplay((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("videos_autoplay", next ? "1" : "0");
      } catch {
        /* non-persistent is fine */
      }
      return next;
    });
  };

  // Position updates are frequent; only send when it moved at least 5 s.
  // sendBeacon (not fetch) because the most important save is the one fired
  // while the page is being torn down — a keepalive fetch still gets cancelled
  // by the navigation there, and the resume point was silently lost.
  const saveProgress = useCallback(
    (position: number) => {
      if (Math.abs(position - lastSent.current) < 5) return;
      lastSent.current = position;
      const url = `/api/videos/${video.id}/progress`;
      const body = JSON.stringify({ position });
      if (
        typeof navigator !== "undefined" &&
        typeof navigator.sendBeacon === "function" &&
        navigator.sendBeacon(url, new Blob([body], { type: "application/json" }))
      ) {
        return;
      }
      void fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    },
    [video.id]
  );

  const countView = useCallback(() => {
    void fetch(`/api/videos/${video.id}/view`, { method: "POST" }).catch(
      () => {}
    );
    setVideo((v) => ({ ...v, views: v.views + 1 }));
  }, [video.id]);

  const next = related[0];
  const goNext = useCallback(() => {
    if (next) router.push(`${basePath}/${next.id}`);
  }, [basePath, next, router]);

  const startOver = async () => {
    await fetch(`/api/videos/${video.id}/progress`, { method: "DELETE" }).catch(
      () => {}
    );
    lastSent.current = 0;
    setResumeAt(0);
    setPlayerKey((k) => k + 1);
  };

  const like = async () => {
    const res = await fetch(`/api/videos/${video.id}/like`, { method: "POST" });
    if (!res.ok) return;
    const data = await res.json();
    setVideo((v) => ({ ...v, liked: data.liked ? 1 : 0, likes: data.likes }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/videos/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: titleDraft,
          description: descDraft.trim() || null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setVideo((v) => ({
          ...v,
          title: data.video.title,
          description: data.video.description,
        }));
        setEditing(false);
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  };

  // Deleting the row alone would be undone by the next scan, so the media file
  // goes with it — spelled out in the confirmation.
  const remove = async () => {
    const ok = await confirmAsk({
      title: "Delete this video?",
      message: `"${video.title}" and its file on disk will be removed. This cannot be undone.`,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    const res = await fetch(`/api/videos/${video.id}?file=1`, {
      method: "DELETE",
    });
    if (res.ok) router.push(basePath);
  };

  const meta = [
    viewLabel(video.views),
    relativeDate(video.added_at),
    video.height ? `${video.height}p` : null,
    formatSize(video.size_bytes),
  ].filter(Boolean);

  return (
    <div className="pb-28 pt-3 text-white">
      <div
        className={cn(
          "mx-auto grid max-w-[1600px] gap-6 px-3 sm:px-5",
          theater ? "grid-cols-1" : "lg:grid-cols-[minmax(0,1fr)_360px]"
        )}
      >
        {/* --- main column --- */}
        <div className="min-w-0">
          {/* The player stays at this exact position in the tree in every mode:
              moving it (e.g. above the grid for theater) would remount it and
              restart playback. Theater/mobile just widen it past the gutters. */}
          <div
            className={cn(
              "-mx-3 mb-3 bg-black sm:-mx-5",
              !theater && "lg:mx-0 lg:overflow-hidden lg:rounded-xl"
            )}
          >
            {video.playable === 0 ? (
              <PendingConversion video={video} isAdmin={isAdmin} />
            ) : (
            <VideoPlayer
              key={`${video.id}:${playerKey}`}
              video={video}
              startAt={resumeAt}
              autoPlay
              theater={theater}
              onToggleTheater={toggleTheater}
              onProgress={saveProgress}
              onFirstPlay={countView}
              onNext={next ? goNext : undefined}
              onEnded={() => {
                if (autoplay && next) goNext();
              }}
              markers={video.metadata?.markers ?? []}
              seekRequest={seekRequest}
            />
            )}
          </div>

          {editing ? (
            <div className="space-y-2">
              <input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-lg font-semibold outline-none focus:border-white/30"
              />
              <textarea
                value={descDraft}
                onChange={(e) => setDescDraft(e.target.value)}
                rows={4}
                placeholder="Description"
                className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-white/30 focus:border-white/30"
              />
              <div className="flex gap-2">
                <button
                  onClick={save}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Check size={14} />
                  )}
                  Save
                </button>
                <button
                  onClick={() => {
                    setEditing(false);
                    setTitleDraft(video.title);
                    setDescDraft(video.description ?? "");
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-4 py-1.5 text-sm transition hover:bg-white/10"
                >
                  <X size={14} />
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <h1 className="text-lg font-semibold leading-snug sm:text-xl">
              {video.title}
            </h1>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-white/45">
            <span>{meta.join(" · ")}</span>
            {video.folder && (
              <Link
                href={`${basePath}?folder=${encodeURIComponent(video.folder)}`}
                className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-white/70 transition hover:bg-white/15"
              >
                <FolderOpen size={12} />
                {video.folder}
              </Link>
            )}
          </div>

          {/* Action row */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={like}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition",
                video.liked
                  ? "border-transparent bg-white text-black"
                  : "border-white/15 hover:bg-white/10"
              )}
            >
              <ThumbsUp size={15} />
              {video.likes > 0 ? video.likes : "Like"}
            </button>

            <a
              href={`/api/videos/${video.id}/stream?download=1`}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3.5 py-1.5 text-sm transition hover:bg-white/10"
            >
              <Download size={15} />
              Download
            </a>

            <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-xs text-white/60">
              Autoplay
              <span
                onClick={toggleAutoplay}
                role="switch"
                aria-checked={autoplay}
                className={cn(
                  "relative h-5 w-9 rounded-full transition",
                  autoplay ? "bg-blue-600" : "bg-white/20"
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 size-4 rounded-full bg-white transition-all",
                    autoplay ? "left-[1.15rem]" : "left-0.5"
                  )}
                />
              </span>
            </label>

            {isAdmin && !editing && (
              <>
                <button
                  onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-sm transition hover:bg-white/10"
                >
                  <Pencil size={14} />
                  Edit
                </button>
                <button
                  onClick={remove}
                  className="inline-flex items-center gap-1.5 rounded-full border border-red-500/30 px-3 py-1.5 text-sm text-red-300 transition hover:bg-red-500/10"
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              </>
            )}
          </div>

          {/* Resume notice */}
          {resumeAt > 5 && (
            <p className="mt-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60">
              Resuming from {formatTime(resumeAt)}.{" "}
              <button onClick={startOver} className="underline hover:text-white">
                Start over
              </button>
            </p>
          )}

          {/* Both channels have a database that can describe them. */}
          {!editing && (
            <VideoMetadataPanel
              videoId={video.id}
              fallbackTitle={video.title}
              metadata={video.metadata ?? null}
              performers={video.cast ?? []}
              isAdmin={isAdmin}
              channel={video.channel === "adults" ? "adults" : "main"}
              onSeek={(time) =>
                setSeekRequest({ time, nonce: Date.now() })
              }
            />
          )}

          {/* Description */}
          {(video.description || video.folder) && !editing && (
            <div
              className={cn(
                "mt-3 rounded-xl bg-white/5 px-3.5 py-3 text-sm text-white/75",
                !expanded && "cursor-pointer"
              )}
              onClick={() => !expanded && setExpanded(true)}
            >
              <p className={cn("whitespace-pre-wrap", !expanded && "line-clamp-3")}>
                {video.description || `In ${video.folder}`}
              </p>
              {video.description && video.description.length > 180 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded((v) => !v);
                  }}
                  className="mt-1 text-xs font-medium text-white/50 hover:text-white"
                >
                  {expanded ? "Show less" : "Show more"}
                </button>
              )}
            </div>
          )}
        </div>

        {/* --- up next rail --- */}
        <aside className="min-w-0">
          <h2 className="mb-2 text-sm font-semibold text-white/80">Up next</h2>
          {related.length === 0 ? (
            <p className="text-xs text-white/40">Nothing else in this library.</p>
          ) : (
            <div
              className={cn(
                "gap-2",
                theater
                  ? "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
                  : "flex flex-col"
              )}
            >
              {related.map((v) => (
                <VideoCard
                  key={v.id}
                  video={v}
                  basePath={basePath}
                  layout={theater ? "grid" : "row"}
                />
              ))}
            </div>
          )}
        </aside>
      </div>

      {confirmDialog}
    </div>
  );
}

// A source no browser can decode (DVD rip, HEVC, AC-3, .mkv/.avi container).
// Showing why — and letting an admin start the conversion — beats handing the
// player a file it can only fail on.
function PendingConversion({
  video,
  isAdmin,
}: {
  video: WatchVideo;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const failed = video.transcode_status === "failed";

  // The request only starts the encode — it finishes long after any HTTP
  // request would have timed out — so the page polls the queue and reloads
  // itself once the run is done and this video has become playable.
  const convert = async () => {
    setBusy(true);
    setNote("Starting…");
    try {
      const res = await fetch(`/api/videos/transcode?id=${video.id}`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.started) {
        setBusy(false);
        setNote(data.message || data.error || "Could not start.");
        return;
      }
      setNote("Converting — this can take a while. The page updates when it's done.");
    } catch {
      setBusy(false);
      setNote("Could not reach the server.");
    }
  };

  // While a run is going, watch the queue; when it stops, pull the fresh row.
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch("/api/videos/transcode");
        if (!res.ok) return;
        const state = await res.json();
        if (!state.running) {
          setBusy(false);
          setNote(state.lastRun?.message ?? null);
          router.refresh();
        }
      } catch {
        /* keep waiting */
      }
    }, 10000);
    return () => clearInterval(timer);
  }, [busy, router]);

  const codecs = [video.video_codec, video.audio_codec].filter(Boolean).join(" + ");

  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 px-6 text-center">
      <FileVideo2 size={30} className="text-white/30" />
      <p className="text-sm font-medium text-white">
        {failed ? "Conversion failed" : "Waiting to be converted"}
      </p>
      <p className="max-w-md text-xs text-white/50">
        {codecs ? `This file is ${codecs}, which ` : "This file's format "}
        no browser can play. It is queued for conversion to MP4; the hourly job
        picks it up.
      </p>
      {failed && video.transcode_error && (
        <p className="max-w-md truncate text-xs text-red-300/80">
          {video.transcode_error}
        </p>
      )}
      {isAdmin && (
        <button
          onClick={convert}
          disabled={busy}
          className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-white/20 px-4 py-1.5 text-sm transition hover:bg-white/10 disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : null}
          {failed ? "Retry now" : "Convert now"}
        </button>
      )}
      {note && <p className="text-xs text-white/40">{note}</p>}
    </div>
  );
}
