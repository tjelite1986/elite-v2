"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ListMusic, Plus } from "lucide-react";
import type { MusicLibrary, Playlist } from "@/lib/music-client";
import { formatTotal, musicFetch } from "@/lib/music-client";
import { useMusicPlayer } from "@/components/music/player-provider";
import {
  Cover,
  LibrarySwitcher,
  MusicPageHeader,
  MusicSkeleton,
  MusicUnavailable,
} from "@/components/music/common";

// The user's playlists, straight from their own Navidrome account — the same
// list their Navidrome web UI shows.
export default function PlaylistsBrowser({ library }: { library: MusicLibrary }) {
  const player = useMusicPlayer();
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    musicFetch<{ playlists: Playlist[] }>("/api/music/playlists", library)
      .then((d) => setPlaylists(d.playlists))
      .catch((e: Error) => setError(e.message));
  }, [library]);

  useEffect(() => {
    setPlaylists(null);
    load();
  }, [load]);

  const create = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await musicFetch("/api/music/playlists", library, {
        method: "POST",
        body: JSON.stringify({ name: trimmed }),
      });
      setName("");
      setCreating(false);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [name, library, load]);

  // Saving what is playing is the reason most playlists get made at all.
  const saveQueue = useCallback(async () => {
    if (!player.queue.length) return;
    const trimmed = name.trim() || `Queue ${new Date().toLocaleDateString()}`;
    setBusy(true);
    try {
      await musicFetch("/api/music/playlists", library, {
        method: "POST",
        body: JSON.stringify({
          name: trimmed,
          songIds: player.queue.map((s) => s.id),
        }),
      });
      setName("");
      setCreating(false);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [name, library, player.queue, load]);

  if (error) return <MusicUnavailable message={error} library={library} />;

  return (
    <div className="pb-8">
      <MusicPageHeader
        title="Playlists"
        right={<LibrarySwitcher library={library} basePath="/music/playlists" />}
      />

      <div className="px-4">
        {creating ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder="Playlist name"
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-white/30"
            />
            <div className="mt-2 flex gap-2">
              <button
                onClick={create}
                disabled={busy || !name.trim()}
                className="flex-1 rounded-lg bg-white py-2 text-sm font-medium text-black disabled:opacity-40"
              >
                Create empty
              </button>
              {player.queue.length > 0 && (
                <button
                  onClick={saveQueue}
                  disabled={busy}
                  className="flex-1 rounded-lg border border-white/15 py-2 text-sm text-white/80 disabled:opacity-40"
                >
                  Save queue ({player.queue.length})
                </button>
              )}
            </div>
            <button
              onClick={() => setCreating(false)}
              className="mt-2 w-full text-xs text-white/40 hover:text-white"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm transition hover:bg-white/10"
          >
            <Plus size={18} className="text-white/50" />
            New playlist
          </button>
        )}
      </div>

      {!playlists ? (
        <MusicSkeleton />
      ) : playlists.length === 0 ? (
        <p className="px-4 py-12 text-center text-sm text-white/40">
          No playlists yet.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-white/5">
          {playlists.map((p) => (
            <li key={p.id}>
              <Link
                href={`/music/playlists/${encodeURIComponent(p.id)}?library=${library}`}
                className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-white/5"
              >
                <Cover
                  coverArt={p.coverArt}
                  library={library}
                  size={96}
                  rounded="rounded"
                  className="h-11 w-11 shrink-0"
                  icon={<ListMusic size={18} />}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{p.name}</span>
                  <span className="block truncate text-xs text-white/40">
                    {[`${p.songCount ?? 0} songs`, formatTotal(p.duration)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
