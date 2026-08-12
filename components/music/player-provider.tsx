"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MusicLibrary, Song } from "@/lib/music-client";
import { coverUrl, streamUrl } from "@/lib/music-client";

// ---------------------------------------------------------------------------
// The app's single audio pipeline. Mounted in app/(authed)/layout.tsx, above
// the router outlet, so the one <audio> element survives every client-side
// navigation — that is what lets a track keep playing while you browse Posts.
//
// It owns the queue, playback state, scrobbling and the MediaSession bindings.
// Every music page only ever calls playQueue(); nothing else touches <audio>.
// ---------------------------------------------------------------------------

export type RepeatMode = "off" | "all" | "one";

const STORAGE_KEY = "elite-music-player";
const SAVE_INTERVAL_MS = 5000;

interface PersistedState {
  queue: Song[];
  index: number;
  library: MusicLibrary;
  position: number;
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
}

interface MusicPlayerValue {
  queue: Song[];
  index: number;
  current: Song | null;
  library: MusicLibrary;
  playing: boolean;
  loading: boolean;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  expanded: boolean;
  error: string | null;

  playQueue: (songs: Song[], startIndex: number, library: MusicLibrary) => void;
  playNow: (song: Song, library: MusicLibrary) => void;
  togglePlay: () => void;
  next: () => void;
  previous: () => void;
  jumpTo: (index: number) => void;
  seek: (seconds: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  enqueue: (songs: Song[], library: MusicLibrary) => void;
  playAfterCurrent: (songs: Song[], library: MusicLibrary) => void;
  removeAt: (index: number) => void;
  clearQueue: () => void;
  setExpanded: (open: boolean) => void;
  markStarred: (songId: string, starred: boolean) => void;
}

const MusicPlayerContext = createContext<MusicPlayerValue | null>(null);

export function useMusicPlayer(): MusicPlayerValue {
  const ctx = useContext(MusicPlayerContext);
  if (!ctx) {
    throw new Error("useMusicPlayer must be used inside MusicPlayerProvider");
  }
  return ctx;
}

/** Fisher-Yates over the indices, with `first` pulled to the front. */
function shuffledOrder(length: number, first: number): number[] {
  const order = Array.from({ length }, (_, i) => i).filter((i) => i !== first);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return first >= 0 ? [first, ...order] : order;
}

export default function MusicPlayerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [queue, setQueue] = useState<Song[]>([]);
  const [index, setIndex] = useState(0);
  const [library, setLibrary] = useState<MusicLibrary>("main");
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);

  // Playback order when shuffling: positions into `queue`. Regenerated whenever
  // shuffle is switched on or a new queue starts, so the same shuffle survives
  // skipping back and forth (unlike re-rolling a random index each time).
  const orderRef = useRef<number[] | null>(null);

  const current = queue[index] ?? null;

  // ------------------------------------------------------------------
  // Restore the last session. Deliberately paused: browsers block autoplay
  // without a gesture, and a page load that starts blasting music is hostile
  // anyway. The stored position is applied once metadata is in.
  // ------------------------------------------------------------------
  const resumeAtRef = useRef<number | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<PersistedState>;
        if (Array.isArray(saved.queue) && saved.queue.length) {
          setQueue(saved.queue);
          setIndex(
            Number.isInteger(saved.index) &&
              saved.index! >= 0 &&
              saved.index! < saved.queue.length
              ? saved.index!
              : 0
          );
          resumeAtRef.current = typeof saved.position === "number" ? saved.position : 0;
        }
        if (saved.library === "kids" || saved.library === "main") setLibrary(saved.library);
        if (typeof saved.volume === "number") setVolumeState(saved.volume);
        if (typeof saved.shuffle === "boolean") setShuffle(saved.shuffle);
        if (saved.repeat === "all" || saved.repeat === "one" || saved.repeat === "off") {
          setRepeat(saved.repeat);
        }
      }
    } catch {
      /* a corrupt entry is not worth failing the app over */
    }
    setRestored(true);
  }, []);

  // Persist on a timer rather than on every timeupdate — the position is the
  // only fast-moving field and second-level accuracy is plenty for resuming.
  useEffect(() => {
    if (!restored) return;
    const save = () => {
      try {
        const state: PersistedState = {
          // Cap what is stored: a "shuffle everything" queue can be thousands
          // of songs, and localStorage is a 5 MB budget shared with the rest.
          queue: queue.slice(0, 500),
          index: Math.min(index, 499),
          library,
          position: audioRef.current?.currentTime ?? 0,
          volume,
          shuffle,
          repeat,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        /* quota or private mode — playback still works */
      }
    };
    save();
    const t = setInterval(save, SAVE_INTERVAL_MS);
    return () => {
      clearInterval(t);
      save();
    };
  }, [restored, queue, index, library, volume, shuffle, repeat]);

  // ------------------------------------------------------------------
  // Scrobbling: "now playing" at the start, then a real submission past the
  // halfway mark (or four minutes, whichever comes first — the Last.fm rule
  // Navidrome forwards). One submission per play, tracked per song instance.
  // ------------------------------------------------------------------
  const scrobbleRef = useRef<{ id: string; submitted: boolean }>({
    id: "",
    submitted: false,
  });

  const scrobble = useCallback(
    (songId: string, submission: boolean, lib: MusicLibrary) => {
      fetch(`/api/music/scrobble?library=${lib}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: songId, submission }),
        keepalive: true,
      }).catch(() => {
        /* reporting must never interrupt playback */
      });
    },
    []
  );

  // ------------------------------------------------------------------
  // Source management: point <audio> at the current track and (re)start it.
  // ------------------------------------------------------------------
  const shouldPlayRef = useRef(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;

    const url = streamUrl(current.id, library);
    if (audio.getAttribute("src") !== url) {
      audio.setAttribute("src", url);
      audio.load();
      setPosition(0);
      setDuration(current.duration ?? 0);
      setError(null);
      scrobbleRef.current = { id: current.id, submitted: false };
      if (shouldPlayRef.current) {
        setLoading(true);
        audio
          .play()
          .then(() => scrobble(current.id, false, library))
          .catch(() => {
            // Autoplay refused (no gesture yet) — stay paused rather than
            // showing a spinner that never resolves.
            setPlaying(false);
            setLoading(false);
          });
      }
    }
  }, [current, library, scrobble]);

  // ------------------------------------------------------------------
  // Queue navigation
  // ------------------------------------------------------------------
  // Computed from the current state rather than inside a setState updater:
  // an updater has to be pure (React may run it twice), and stopping at the end
  // of the queue is a side effect.
  const advance = useCallback(
    (delta: number, auto: boolean) => {
      if (!queue.length) return;
      if (auto && repeat === "one") return;

      const order = shuffle ? orderRef.current : null;
      if (order && order.length === queue.length) {
        const pos = order.indexOf(index);
        const nextPos = pos + delta;
        if (nextPos < 0) {
          setIndex(order[order.length - 1]);
        } else if (nextPos >= order.length) {
          if (repeat === "all" || !auto) setIndex(order[0]);
          else {
            shouldPlayRef.current = false;
            setPlaying(false);
          }
        } else {
          setIndex(order[nextPos]);
        }
        return;
      }

      const nextIndex = index + delta;
      if (nextIndex < 0) {
        setIndex(queue.length - 1);
      } else if (nextIndex >= queue.length) {
        // End of the queue with repeat off: stop on the last track rather than
        // wrapping silently.
        if (repeat === "all" || !auto) setIndex(0);
        else {
          shouldPlayRef.current = false;
          setPlaying(false);
        }
      } else {
        setIndex(nextIndex);
      }
    },
    [index, queue.length, repeat, shuffle]
  );

  const next = useCallback(() => {
    shouldPlayRef.current = true;
    advance(1, false);
  }, [advance]);

  const previous = useCallback(() => {
    const audio = audioRef.current;
    // Standard player behaviour: past three seconds, "previous" restarts the
    // current track instead of jumping back.
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    shouldPlayRef.current = true;
    advance(-1, false);
  }, [advance]);

  const handleEnded = useCallback(() => {
    const audio = audioRef.current;
    if (repeat === "one" && audio) {
      audio.currentTime = 0;
      void audio.play().catch(() => setPlaying(false));
      return;
    }
    shouldPlayRef.current = true;
    advance(1, true);
  }, [advance, repeat]);

  // ------------------------------------------------------------------
  // Public actions
  // ------------------------------------------------------------------
  const playQueue = useCallback(
    (songs: Song[], startIndex: number, lib: MusicLibrary) => {
      if (!songs.length) return;
      const start = Math.min(Math.max(startIndex, 0), songs.length - 1);
      orderRef.current = shuffle ? shuffledOrder(songs.length, start) : null;
      shouldPlayRef.current = true;
      resumeAtRef.current = null;
      setLibrary(lib);
      setQueue(songs);
      setIndex(start);
      setPlaying(true);
    },
    [shuffle]
  );

  const playNow = useCallback(
    (song: Song, lib: MusicLibrary) => playQueue([song], 0, lib),
    [playQueue]
  );

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (audio.paused) {
      shouldPlayRef.current = true;
      setLoading(true);
      audio
        .play()
        .then(() => {
          if (!scrobbleRef.current.submitted && scrobbleRef.current.id !== current.id) {
            scrobbleRef.current = { id: current.id, submitted: false };
          }
          scrobble(current.id, false, library);
        })
        .catch((e: Error) => {
          setError(e.message);
          setLoading(false);
        });
    } else {
      shouldPlayRef.current = false;
      audio.pause();
    }
  }, [current, library, scrobble]);

  const jumpTo = useCallback((i: number) => {
    shouldPlayRef.current = true;
    setIndex(i);
    setPlaying(true);
  }, []);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, seconds);
    setPosition(audio.currentTime);
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.min(Math.max(v, 0), 1);
    setVolumeState(clamped);
    setMuted(clamped === 0);
    if (audioRef.current) audioRef.current.volume = clamped;
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      if (audioRef.current) audioRef.current.muted = !m;
      return !m;
    });
  }, []);

  const toggleShuffle = useCallback(() => {
    setShuffle((s) => {
      const on = !s;
      orderRef.current = on ? shuffledOrder(queue.length, index) : null;
      return on;
    });
  }, [index, queue.length]);

  const cycleRepeat = useCallback(() => {
    setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off"));
  }, []);

  const enqueue = useCallback(
    (songs: Song[], lib: MusicLibrary) => {
      if (!songs.length) return;
      const merged = [...queue, ...songs];
      setLibrary(lib);
      setQueue(merged);
      if (shuffle) orderRef.current = shuffledOrder(merged.length, index);
      // Appending to an empty queue is a play request, not a queue edit.
      if (!queue.length) {
        shouldPlayRef.current = true;
        setIndex(0);
        setPlaying(true);
      }
    },
    [index, queue, shuffle]
  );

  const playAfterCurrent = useCallback(
    (songs: Song[], lib: MusicLibrary) => {
      if (!songs.length) return;
      setLibrary(lib);
      if (!queue.length) {
        orderRef.current = shuffle ? shuffledOrder(songs.length, 0) : null;
        shouldPlayRef.current = true;
        setQueue(songs);
        setIndex(0);
        setPlaying(true);
        return;
      }
      const merged = [
        ...queue.slice(0, index + 1),
        ...songs,
        ...queue.slice(index + 1),
      ];
      setQueue(merged);
      if (shuffle) orderRef.current = shuffledOrder(merged.length, index);
    },
    [index, queue, shuffle]
  );

  const removeAt = useCallback(
    (i: number) => {
      if (i < 0 || i >= queue.length) return;
      const merged = queue.filter((_, n) => n !== i);
      // Removing a row above the current one shifts it down; removing the last
      // remaining row clamps to 0.
      const nextIndex = Math.min(
        i < index ? index - 1 : index,
        Math.max(merged.length - 1, 0)
      );
      setQueue(merged);
      setIndex(nextIndex);
      if (shuffle) orderRef.current = shuffledOrder(merged.length, nextIndex);
    },
    [index, queue, shuffle]
  );

  const clearQueue = useCallback(() => {
    shouldPlayRef.current = false;
    audioRef.current?.pause();
    audioRef.current?.removeAttribute("src");
    orderRef.current = null;
    setQueue([]);
    setIndex(0);
    setPlaying(false);
    setPosition(0);
    setDuration(0);
    setExpanded(false);
  }, []);

  // Keep a starred toggle made anywhere in the UI reflected in the queue copy
  // of the song, so the now-playing heart matches the list it came from.
  const markStarred = useCallback((songId: string, starred: boolean) => {
    setQueue((q) =>
      q.map((s) => (s.id === songId ? { ...s, starred } : s))
    );
  }, []);

  // ------------------------------------------------------------------
  // <audio> event wiring
  // ------------------------------------------------------------------
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTime = () => {
      setPosition(audio.currentTime);
      const total = audio.duration || current?.duration || 0;
      const state = scrobbleRef.current;
      if (
        current &&
        state.id === current.id &&
        !state.submitted &&
        total > 0 &&
        (audio.currentTime > total / 2 || audio.currentTime > 240)
      ) {
        state.submitted = true;
        scrobble(current.id, true, library);
      }
    };
    const onMeta = () => {
      if (Number.isFinite(audio.duration)) setDuration(audio.duration);
      // One-shot resume of the position saved before the last reload.
      if (resumeAtRef.current != null) {
        const at = resumeAtRef.current;
        resumeAtRef.current = null;
        if (at > 0 && at < audio.duration) audio.currentTime = at;
      }
    };
    const onPlay = () => {
      setPlaying(true);
      setLoading(false);
      setError(null);
    };
    const onPause = () => setPlaying(false);
    const onWaiting = () => setLoading(true);
    const onPlaying = () => setLoading(false);
    const onError = () => {
      setLoading(false);
      setPlaying(false);
      setError("This track could not be played");
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("error", onError);
    audio.addEventListener("ended", handleEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [current, handleEnded, library, scrobble]);

  // ------------------------------------------------------------------
  // MediaSession: lock screen, notification shade and Bluetooth buttons.
  // ------------------------------------------------------------------
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    if (!current) {
      navigator.mediaSession.metadata = null;
      return;
    }
    const art = coverUrl(current.coverArt, library, 512);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artist || "",
      album: current.album || "",
      artwork: art ? [{ src: art, sizes: "512x512", type: "image/jpeg" }] : [],
    });
  }, [current, library]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => togglePlay()],
      ["pause", () => togglePlay()],
      ["nexttrack", () => next()],
      ["previoustrack", () => previous()],
      ["seekbackward", () => seek((audioRef.current?.currentTime ?? 0) - 10)],
      ["seekforward", () => seek((audioRef.current?.currentTime ?? 0) + 10)],
      [
        "seekto",
        (details) => {
          if (typeof details.seekTime === "number") seek(details.seekTime);
        },
      ],
    ];
    for (const [action, handler] of handlers) {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        // Not every browser implements every action; the rest still bind.
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          ms.setActionHandler(action, null);
        } catch {
          /* noop */
        }
      }
    };
  }, [next, previous, seek, togglePlay]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }, [playing]);

  // ------------------------------------------------------------------
  // Layout: the mini player occupies a strip above the bottom nav, so the
  // page's bottom padding and every FAB anchored to --fab-offset have to move
  // up by exactly that much while a track is loaded.
  // ------------------------------------------------------------------
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--player-h", current ? "3.5rem" : "0px");
    return () => root.style.setProperty("--player-h", "0px");
  }, [current]);

  const value = useMemo<MusicPlayerValue>(
    () => ({
      queue,
      index,
      current,
      library,
      playing,
      loading,
      position,
      duration,
      volume,
      muted,
      shuffle,
      repeat,
      expanded,
      error,
      playQueue,
      playNow,
      togglePlay,
      next,
      previous,
      jumpTo,
      seek,
      setVolume,
      toggleMute,
      toggleShuffle,
      cycleRepeat,
      enqueue,
      playAfterCurrent,
      removeAt,
      clearQueue,
      setExpanded,
      markStarred,
    }),
    [
      queue,
      index,
      current,
      library,
      playing,
      loading,
      position,
      duration,
      volume,
      muted,
      shuffle,
      repeat,
      expanded,
      error,
      playQueue,
      playNow,
      togglePlay,
      next,
      previous,
      jumpTo,
      seek,
      setVolume,
      toggleMute,
      toggleShuffle,
      cycleRepeat,
      enqueue,
      playAfterCurrent,
      removeAt,
      clearQueue,
      markStarred,
    ]
  );

  return (
    <MusicPlayerContext.Provider value={value}>
      {children}
      {/* One element for the whole app. preload="metadata" keeps a queued-up
          track from eating bandwidth before it is reached. */}
      <audio ref={audioRef} preload="metadata" playsInline />
    </MusicPlayerContext.Provider>
  );
}
