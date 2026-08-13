"use client";

// Offline downloads for /music.
//
// A download is just the ordinary stream response stored in the Cache Storage
// API under its own URL, plus a small metadata registry in localStorage so the
// downloads page can list tracks without asking the server. The service worker
// (public/sw.js) serves any stream request that has a cache entry — including
// Range requests, which it answers itself out of the cached bytes — so playback
// works with no network and without a second code path in the player.
//
// Nothing here needs the network to be up: every read is local.

import type { MusicLibrary, Song } from "./music-client";
import { coverUrl, streamUrl } from "./music-client";

/** Must match MUSIC_CACHE in public/sw.js. */
export const MUSIC_CACHE = "elite-music-offline-v1";
const REGISTRY_KEY = "elite-music-downloads";
// The cover sizes the music UI renders: list rows (96) and cards/now playing.
const COVER_SIZES = [96, 300, 600];

export interface DownloadedSong {
  song: Song;
  library: MusicLibrary;
  bytes: number;
  savedAt: number;
}

type Registry = Record<string, DownloadedSong>;

export function downloadKey(songId: string, library: MusicLibrary): string {
  return `${library}:${songId}`;
}

export function offlineSupported(): boolean {
  return typeof caches !== "undefined" && typeof localStorage !== "undefined";
}

function readRegistry(): Registry {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(REGISTRY_KEY);
    const parsed = raw ? (JSON.parse(raw) as Registry) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeRegistry(registry: Registry): void {
  try {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(registry));
  } catch {
    /* quota: the audio is already cached, only the listing is lost */
  }
  notify();
}

// ---------------------------------------------------------------------------
// Subscriptions — every download button on screen reflects the same state, so
// a change has to reach components that never triggered it.
// ---------------------------------------------------------------------------
const listeners = new Set<() => void>();
// A counter rather than the list itself: useSyncExternalStore needs a snapshot
// that only changes when the data does, and listDownloads() builds a new array
// on every call.
let version = 0;

export function subscribeDownloads(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function downloadsVersion(): number {
  return version;
}

function notify(): void {
  version++;
  for (const listener of listeners) listener();
}

export function listDownloads(): DownloadedSong[] {
  return Object.values(readRegistry()).sort((a, b) => b.savedAt - a.savedAt);
}

export function isDownloaded(songId: string, library: MusicLibrary): boolean {
  return Boolean(readRegistry()[downloadKey(songId, library)]);
}

export function downloadedBytes(): number {
  return Object.values(readRegistry()).reduce((sum, d) => sum + d.bytes, 0);
}

/**
 * Store one track (and its cover) for offline playback. Resolves silently if it
 * is already downloaded, so an "download album" over a partly-downloaded album
 * only fetches what is missing.
 */
export async function downloadSong(
  song: Song,
  library: MusicLibrary
): Promise<void> {
  if (!offlineSupported()) throw new Error("This browser cannot store downloads");
  const key = downloadKey(song.id, library);
  const registry = readRegistry();
  if (registry[key]) return;

  const cache = await caches.open(MUSIC_CACHE);
  const url = streamUrl(song.id, library);

  // No Range header, so the proxy answers 200 with the whole file — Cache.put
  // rejects a 206, which is exactly why this cannot reuse a player request.
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const body = await res.blob();
  await cache.put(
    url,
    new Response(body, {
      status: 200,
      headers: {
        "content-type": res.headers.get("content-type") || "audio/mpeg",
        "content-length": String(body.size),
        "accept-ranges": "bytes",
      },
    })
  );

  // Artwork is small and makes the offline list look like the online one. Both
  // sizes the music UI asks for are stored, because a cache entry is keyed by
  // the whole URL — a 300 px entry does nothing for a 96 px row.
  for (const size of COVER_SIZES) {
    const cover = coverUrl(song.coverArt, library, size);
    if (!cover) break;
    await cache.add(cover).catch(() => {
      /* artwork is optional; the track is what matters */
    });
  }

  registry[key] = { song, library, bytes: body.size, savedAt: Date.now() };
  writeRegistry(registry);
}

/** Remove one track's audio, artwork and registry entry. */
export async function removeDownload(
  songId: string,
  library: MusicLibrary
): Promise<void> {
  const registry = readRegistry();
  const entry = registry[downloadKey(songId, library)];
  if (offlineSupported()) {
    const cache = await caches.open(MUSIC_CACHE);
    await cache.delete(streamUrl(songId, library));
    for (const size of COVER_SIZES) {
      const cover = entry ? coverUrl(entry.song.coverArt, library, size) : null;
      if (cover) await cache.delete(cover);
    }
  }
  delete registry[downloadKey(songId, library)];
  writeRegistry(registry);
}

export async function removeAllDownloads(): Promise<void> {
  if (offlineSupported()) await caches.delete(MUSIC_CACHE);
  writeRegistry({});
}

/**
 * Drop registry rows whose audio is gone — the browser can evict a cache under
 * storage pressure, and a listing that offers tracks the device no longer has
 * is worse than a shorter one.
 */
export async function pruneDownloads(): Promise<void> {
  if (!offlineSupported()) return;
  const registry = readRegistry();
  const keys = Object.keys(registry);
  if (!keys.length) return;
  const cache = await caches.open(MUSIC_CACHE);
  let changed = false;
  for (const key of keys) {
    const entry = registry[key];
    const hit = await cache.match(streamUrl(entry.song.id, entry.library));
    if (!hit) {
      delete registry[key];
      changed = true;
    }
  }
  if (changed) writeRegistry(registry);
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.round(bytes / 1024)} kB`;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}
