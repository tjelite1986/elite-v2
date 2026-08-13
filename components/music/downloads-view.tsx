"use client";

import { useEffect, useState } from "react";
import { CloudOff, Download, Play, Trash2 } from "lucide-react";
import type { MusicLibrary } from "@/lib/music-client";
import { formatDuration } from "@/lib/music-client";
import {
  formatBytes,
  offlineSupported,
  pruneDownloads,
  removeAllDownloads,
} from "@/lib/music-offline";
import { useDownloads } from "@/lib/use-downloads";
import { useMusicPlayer } from "@/components/music/player-provider";
import { Cover, MusicPageHeader } from "@/components/music/common";

// Everything stored on this device. Deliberately per-device and not synced:
// a download is disk on the phone you did it from, and pretending otherwise
// would list tracks that cannot play.
export default function DownloadsView() {
  const player = useMusicPlayer();
  const { downloads, bytes, remove } = useDownloads();
  const [supported, setSupported] = useState(true);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setSupported(offlineSupported());
    // The browser can evict a cache under storage pressure; drop any row whose
    // audio is gone before showing the list.
    void pruneDownloads();
  }, []);

  const songs = downloads.map((d) => d.song);
  const libraries = new Set(downloads.map((d) => d.library));
  // A queue is played against one library; a mixed list plays the first one's.
  const playLibrary: MusicLibrary = downloads[0]?.library ?? "main";

  return (
    <div className="pb-8">
      <MusicPageHeader
        title="Downloads"
        subtitle={
          downloads.length
            ? `${downloads.length} ${downloads.length === 1 ? "track" : "tracks"} · ${formatBytes(bytes)}`
            : "On this device"
        }
      />

      {!supported ? (
        <div className="px-4 py-16 text-center text-white/40">
          <CloudOff size={36} className="mx-auto text-white/20" />
          <p className="mt-3 text-sm">
            This browser cannot store downloads. Install the app or use a
            browser with Cache Storage.
          </p>
        </div>
      ) : downloads.length === 0 ? (
        <div className="px-4 py-16 text-center text-white/40">
          <Download size={36} className="mx-auto text-white/20" />
          <p className="mt-3 text-sm">
            Nothing downloaded yet. Use “Download” in a track&apos;s menu, or
            download a whole album from its page.
          </p>
        </div>
      ) : (
        <>
          <div className="flex gap-2 px-4">
            <button
              onClick={() => player.playQueue(songs, 0, playLibrary)}
              className="flex items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-medium text-black transition hover:bg-white/90"
            >
              <Play size={16} fill="currentColor" />
              Play all
            </button>
            <button
              onClick={() => {
                if (confirming) {
                  void removeAllDownloads();
                  setConfirming(false);
                } else {
                  setConfirming(true);
                }
              }}
              onBlur={() => setConfirming(false)}
              className="flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm text-white/70 transition hover:text-rose-400"
            >
              <Trash2 size={16} />
              {confirming ? "Tap again to delete all" : "Delete all"}
            </button>
          </div>

          {libraries.size > 1 && (
            <p className="px-4 pt-3 text-xs text-white/35">
              These tracks come from more than one library — “Play all” queues
              them against the first one.
            </p>
          )}

          <ul className="mt-4 divide-y divide-white/5">
            {downloads.map((entry, i) => (
              <li
                key={`${entry.library}:${entry.song.id}`}
                className="flex items-center gap-3 px-4 py-2"
              >
                <button
                  onClick={() => player.playQueue(songs, i, entry.library)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <Cover
                    coverArt={entry.song.coverArt}
                    library={entry.library}
                    size={96}
                    rounded="rounded"
                    className="h-10 w-10 shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{entry.song.title}</span>
                    <span className="block truncate text-xs text-white/40">
                      {[entry.song.artist, formatBytes(entry.bytes)]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </button>
                <span className="shrink-0 text-xs tabular-nums text-white/30">
                  {formatDuration(entry.song.duration)}
                </span>
                <button
                  onClick={() => remove(entry.song.id, entry.library)}
                  aria-label="Remove download"
                  className="shrink-0 rounded p-1 text-white/30 transition hover:text-rose-400"
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
