"use client";

import { useCallback, useEffect, useState } from "react";
import { ListPlus, Loader2, Plus } from "lucide-react";
import { useBackDismiss } from "@/lib/use-back-dismiss";
import type { MusicLibrary, Playlist } from "@/lib/music-client";
import { musicFetch } from "@/lib/music-client";

// Bottom sheet: put one or more songs into an existing playlist, or into a new
// one. Playlists live on the user's Navidrome account, so anything created here
// shows up in Navidrome and every other Subsonic client too.
export default function AddToPlaylist({
  songIds,
  library,
  open,
  onClose,
  onDone,
}: {
  songIds: string[];
  library: MusicLibrary;
  open: boolean;
  onClose: () => void;
  onDone?: (playlistName: string) => void;
}) {
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useBackDismiss(open, onClose);

  useEffect(() => {
    if (!open) return;
    setError(null);
    musicFetch<{ playlists: Playlist[] }>("/api/music/playlists", library)
      .then((d) => setPlaylists(d.playlists))
      .catch((e: Error) => {
        setPlaylists([]);
        setError(e.message);
      });
  }, [open, library]);

  const addTo = useCallback(
    async (playlist: Playlist) => {
      setBusy(true);
      setError(null);
      try {
        await musicFetch(
          `/api/music/playlists/${encodeURIComponent(playlist.id)}`,
          library,
          { method: "PATCH", body: JSON.stringify({ add: songIds }) }
        );
        onDone?.(playlist.name);
        onClose();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [library, songIds, onClose, onDone]
  );

  const create = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      await musicFetch("/api/music/playlists", library, {
        method: "POST",
        body: JSON.stringify({ name, songIds }),
      });
      onDone?.(name);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [newName, songIds, library, onClose, onDone]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative max-h-[70dvh] w-full overflow-y-auto rounded-t-2xl border-t border-white/10 bg-[#16161c] pb-[env(safe-area-inset-bottom)]"
      >
        <div className="sticky top-0 flex items-center gap-2 border-b border-white/10 bg-[#16161c] px-4 py-3">
          <ListPlus size={18} className="text-white/50" />
          <span className="text-sm font-medium">
            Add {songIds.length > 1 ? `${songIds.length} songs` : "song"} to playlist
          </span>
        </div>

        {error && <p className="px-4 pt-3 text-xs text-rose-400">{error}</p>}

        <div className="p-2">
          {creating ? (
            <div className="flex gap-2 p-2">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && create()}
                placeholder="Playlist name"
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-white/30"
              />
              <button
                onClick={create}
                disabled={busy || !newName.trim()}
                className="rounded-lg bg-white px-4 text-sm font-medium text-black disabled:opacity-40"
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : "Create"}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition hover:bg-white/5"
            >
              <Plus size={18} className="text-white/50" />
              New playlist
            </button>
          )}

          {playlists === null ? (
            <p className="px-3 py-4 text-sm text-white/40">Loading…</p>
          ) : (
            playlists.map((p) => (
              <button
                key={p.id}
                onClick={() => addTo(p)}
                disabled={busy}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition hover:bg-white/5 disabled:opacity-50"
              >
                <span className="truncate">{p.name}</span>
                <span className="shrink-0 text-xs text-white/35">
                  {p.songCount ?? 0}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
