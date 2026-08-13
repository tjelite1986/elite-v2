"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { MusicLibrary, Song } from "./music-client";
import {
  DownloadedSong,
  downloadSong,
  downloadedBytes,
  downloadsVersion,
  isDownloaded,
  listDownloads,
  removeDownload,
  subscribeDownloads,
} from "./music-offline";

/**
 * Live view of the offline downloads. Every button that can start or delete a
 * download reads through this hook, so one change repaints all of them.
 *
 * The server snapshot is a constant: downloads only exist in the browser, and
 * rendering "downloaded" during SSR would flash the wrong icon on first paint.
 */
export function useDownloads(): {
  downloads: DownloadedSong[];
  bytes: number;
  has: (songId: string, library: MusicLibrary) => boolean;
  download: (song: Song, library: MusicLibrary) => Promise<void>;
  remove: (songId: string, library: MusicLibrary) => Promise<void>;
} {
  const version = useSyncExternalStore(
    subscribeDownloads,
    downloadsVersion,
    () => 0
  );

  const downloads = useMemo(() => {
    void version;
    return typeof window === "undefined" ? [] : listDownloads();
  }, [version]);

  const bytes = useMemo(() => {
    void version;
    return typeof window === "undefined" ? 0 : downloadedBytes();
  }, [version]);

  const has = useCallback(
    (songId: string, library: MusicLibrary) => {
      void version;
      return typeof window === "undefined" ? false : isDownloaded(songId, library);
    },
    [version]
  );

  return { downloads, bytes, has, download: downloadSong, remove: removeDownload };
}
