"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Heart, ListPlus, Play, Shuffle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Album, MusicLibrary, Song } from "@/lib/music-client";
import { formatTotal, musicFetch } from "@/lib/music-client";
import { useMusicPlayer } from "@/components/music/player-provider";
import { Cover, MusicSkeleton, MusicUnavailable } from "@/components/music/common";
import SongList from "@/components/music/song-list";
import AddToPlaylist from "@/components/music/add-to-playlist";

export default function AlbumView({
  albumId,
  library,
}: {
  albumId: string;
  library: MusicLibrary;
}) {
  const player = useMusicPlayer();
  const [album, setAlbum] = useState<Album | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [starred, setStarred] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    musicFetch<{ album: Album; songs: Song[] }>(
      `/api/music/albums/${encodeURIComponent(albumId)}`,
      library
    )
      .then((data) => {
        if (cancelled) return;
        setAlbum(data.album);
        setSongs(data.songs);
        setStarred(data.album.starred);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [albumId, library]);

  if (error) return <MusicUnavailable message={error} library={library} />;
  if (!album) return <MusicSkeleton />;

  const toggleStar = async () => {
    const next = !starred;
    setStarred(next);
    try {
      await musicFetch("/api/music/star", library, {
        method: "POST",
        body: JSON.stringify({ id: album.id, type: "album", starred: next }),
      });
    } catch {
      setStarred(!next);
    }
  };

  return (
    <div className="pb-8">
      <div className="flex flex-col items-center px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)]">
        <Cover
          coverArt={album.coverArt}
          library={library}
          size={600}
          rounded="rounded-xl"
          className="h-44 w-44 shadow-2xl"
        />
        <h1 className="mt-4 text-center text-lg font-semibold">{album.name}</h1>
        {album.artistId ? (
          <Link
            href={`/music/artists/${encodeURIComponent(album.artistId)}?library=${library}`}
            className="text-sm text-white/50 transition hover:text-white"
          >
            {album.artist}
          </Link>
        ) : (
          <p className="text-sm text-white/50">{album.artist}</p>
        )}
        <p className="mt-0.5 text-xs text-white/35">
          {[
            album.year || null,
            album.genre,
            `${songs.length} ${songs.length === 1 ? "track" : "tracks"}`,
            formatTotal(album.duration),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={() => player.playQueue(songs, 0, library)}
            className="flex items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-medium text-black transition hover:bg-white/90"
          >
            <Play size={16} fill="currentColor" />
            Play
          </button>
          <button
            onClick={() => {
              const shuffled = [...songs].sort(() => Math.random() - 0.5);
              player.playQueue(shuffled, 0, library);
            }}
            aria-label="Shuffle album"
            className="rounded-full border border-white/10 p-2.5 text-white/70 transition hover:text-white"
          >
            <Shuffle size={16} />
          </button>
          <button
            onClick={toggleStar}
            aria-label={starred ? "Unfavourite album" : "Favourite album"}
            className={cn(
              "rounded-full border border-white/10 p-2.5 transition",
              starred ? "text-rose-400" : "text-white/70 hover:text-white"
            )}
          >
            <Heart size={16} fill={starred ? "currentColor" : "none"} />
          </button>
          <button
            onClick={() => setAddOpen(true)}
            aria-label="Add album to playlist"
            className="rounded-full border border-white/10 p-2.5 text-white/70 transition hover:text-white"
          >
            <ListPlus size={16} />
          </button>
        </div>
      </div>

      <div className="mt-6">
        <SongList songs={songs} library={library} variant="track" />
      </div>

      <AddToPlaylist
        songIds={songs.map((s) => s.id)}
        library={library}
        open={addOpen}
        onClose={() => setAddOpen(false)}
      />
    </div>
  );
}
