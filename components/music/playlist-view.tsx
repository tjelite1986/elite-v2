"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ListMusic,
  Pencil,
  Play,
  Shuffle,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { MusicLibrary, Playlist, Song } from "@/lib/music-client";
import { formatDuration, formatTotal, musicFetch } from "@/lib/music-client";
import { useMusicPlayer } from "@/components/music/player-provider";
import { Cover, MusicSkeleton, MusicUnavailable } from "@/components/music/common";
import SongList from "@/components/music/song-list";

// One playlist, with in-place editing: rename, remove tracks, and reorder.
// Reordering writes the full ordered id list back (Subsonic has no move
// operation), so the edit mode batches moves and saves once.
export default function PlaylistView({
  playlistId,
  library,
}: {
  playlistId: string;
  library: MusicLibrary;
}) {
  const player = useMusicPlayer();
  const router = useRouter();
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Song[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await musicFetch<{ playlist: Playlist; songs: Song[] }>(
        `/api/music/playlists/${encodeURIComponent(playlistId)}`,
        library
      );
      setPlaylist(data.playlist);
      setSongs(data.songs);
      setName(data.playlist.name);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [playlistId, library]);

  useEffect(() => {
    load();
  }, [load]);

  const removeAt = useCallback(
    async (index: number) => {
      setBusy(true);
      try {
        await musicFetch(
          `/api/music/playlists/${encodeURIComponent(playlistId)}`,
          library,
          { method: "PATCH", body: JSON.stringify({ remove: [index] }) }
        );
        setSongs((s) => s.filter((_, i) => i !== index));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [playlistId, library]
  );

  const move = (index: number, delta: number) => {
    setDraft((list) => {
      const to = index + delta;
      if (to < 0 || to >= list.length) return list;
      const copy = [...list];
      [copy[index], copy[to]] = [copy[to], copy[index]];
      return copy;
    });
  };

  const saveEdits = useCallback(async () => {
    setBusy(true);
    try {
      const body: { order?: string[]; name?: string } = {};
      const orderChanged =
        draft.length !== songs.length ||
        draft.some((s, i) => s.id !== songs[i]?.id);
      if (orderChanged) body.order = draft.map((s) => s.id);
      if (name.trim() && name.trim() !== playlist?.name) body.name = name.trim();
      if (Object.keys(body).length) {
        await musicFetch(
          `/api/music/playlists/${encodeURIComponent(playlistId)}`,
          library,
          { method: "PATCH", body: JSON.stringify(body) }
        );
      }
      setEditing(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [draft, songs, name, playlist, playlistId, library, load]);

  const remove = useCallback(async () => {
    if (!confirm("Delete this playlist?")) return;
    setBusy(true);
    try {
      await musicFetch(
        `/api/music/playlists/${encodeURIComponent(playlistId)}`,
        library,
        { method: "DELETE" }
      );
      router.push(`/music/playlists?library=${library}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }, [playlistId, library, router]);

  if (error) return <MusicUnavailable message={error} library={library} />;
  if (!playlist) return <MusicSkeleton />;

  const list = editing ? draft : songs;

  return (
    <div className="pb-8">
      <div className="flex flex-col items-center px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)]">
        <Cover
          coverArt={playlist.coverArt}
          library={library}
          size={600}
          rounded="rounded-xl"
          className="h-40 w-40 shadow-2xl"
          icon={<ListMusic size={40} />}
        />
        {editing ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-4 w-full max-w-xs rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-center text-sm outline-none focus:border-white/30"
          />
        ) : (
          <h1 className="mt-4 text-center text-lg font-semibold">{playlist.name}</h1>
        )}
        <p className="mt-0.5 text-xs text-white/35">
          {[
            `${songs.length} ${songs.length === 1 ? "song" : "songs"}`,
            formatTotal(playlist.duration),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={() => songs.length && player.playQueue(songs, 0, library)}
            disabled={!songs.length}
            className="flex items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-40"
          >
            <Play size={16} fill="currentColor" />
            Play
          </button>
          <button
            onClick={() => {
              const shuffled = [...songs].sort(() => Math.random() - 0.5);
              if (shuffled.length) player.playQueue(shuffled, 0, library);
            }}
            aria-label="Shuffle playlist"
            className="rounded-full border border-white/10 p-2.5 text-white/70 transition hover:text-white"
          >
            <Shuffle size={16} />
          </button>
          <button
            onClick={() => {
              if (editing) {
                saveEdits();
              } else {
                setDraft(songs);
                setEditing(true);
              }
            }}
            disabled={busy}
            aria-label={editing ? "Save changes" : "Edit playlist"}
            className={cn(
              "rounded-full border border-white/10 p-2.5 transition",
              editing ? "text-emerald-400" : "text-white/70 hover:text-white"
            )}
          >
            {editing ? <Check size={16} /> : <Pencil size={16} />}
          </button>
          <button
            onClick={remove}
            disabled={busy}
            aria-label="Delete playlist"
            className="rounded-full border border-white/10 p-2.5 text-white/70 transition hover:text-rose-400"
          >
            <Trash2 size={16} />
          </button>
        </div>
        {editing && (
          <button
            onClick={() => setEditing(false)}
            className="mt-2 text-xs text-white/40 hover:text-white"
          >
            Cancel
          </button>
        )}
      </div>

      <div className="mt-6">
        {editing ? (
          <ul className="divide-y divide-white/5">
            {list.map((song, i) => (
              <li key={`${song.id}-${i}`} className="flex items-center gap-2 px-4 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{song.title}</span>
                  <span className="block truncate text-xs text-white/40">
                    {song.artist}
                  </span>
                </span>
                <span className="text-xs tabular-nums text-white/30">
                  {formatDuration(song.duration)}
                </span>
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label="Move up"
                  className="rounded p-1 text-white/40 transition hover:text-white disabled:opacity-20"
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === list.length - 1}
                  aria-label="Move down"
                  className="rounded p-1 text-white/40 transition hover:text-white disabled:opacity-20"
                >
                  <ArrowDown size={16} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <SongList
            songs={songs}
            library={library}
            variant="cover"
            onRemove={removeAt}
          />
        )}
      </div>
    </div>
  );
}
