"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Shuffle } from "lucide-react";
import type { Album, MusicLibrary, Song } from "@/lib/music-client";
import { musicFetch } from "@/lib/music-client";
import { useMusicPlayer } from "@/components/music/player-provider";
import {
  AlbumCard,
  MusicPageHeader,
  MusicSkeleton,
  MusicUnavailable,
  Shelf,
} from "@/components/music/common";
import SongList from "@/components/music/song-list";

interface GenreData {
  songs: Song[];
  albums: Album[];
  hasMore: boolean;
}

// One genre: its albums on a shelf, then its tracks, paged as you scroll.
export default function GenreView({
  genre,
  library,
}: {
  genre: string;
  library: MusicLibrary;
}) {
  const player = useMusicPlayer();
  const [songs, setSongs] = useState<Song[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement | null>(null);

  const load = useCallback(
    async (offset: number) => {
      try {
        const data = await musicFetch<GenreData>(
          `/api/music/genres/${encodeURIComponent(genre)}?offset=${offset}`,
          library
        );
        setSongs((prev) => (offset === 0 ? data.songs : [...prev, ...data.songs]));
        if (offset === 0) setAlbums(data.albums);
        setHasMore(data.hasMore);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [genre, library]
  );

  useEffect(() => {
    setSongs([]);
    setAlbums([]);
    setLoading(true);
    setError(null);
    load(0);
  }, [load]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || loading) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setLoading(true);
        load(songs.length);
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, load, songs.length]);

  const shuffleGenre = useCallback(async () => {
    try {
      const { songs: random } = await musicFetch<{ songs: Song[] }>(
        `/api/music/random?size=100&genre=${encodeURIComponent(genre)}`,
        library
      );
      if (random.length) player.playQueue(random, 0, library);
    } catch {
      /* the shuffle button is a shortcut; a failure leaves the page as it is */
    }
  }, [genre, library, player]);

  if (error) return <MusicUnavailable message={error} library={library} />;

  return (
    <div className="pb-8">
      <MusicPageHeader title={genre} subtitle="Genre" />

      <div className="flex gap-2 px-4">
        <button
          onClick={() => songs.length && player.playQueue(songs, 0, library)}
          disabled={!songs.length}
          className="flex items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-40"
        >
          <Play size={16} fill="currentColor" />
          Play
        </button>
        <button
          onClick={shuffleGenre}
          className="flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm text-white/70 transition hover:text-white"
        >
          <Shuffle size={16} />
          Shuffle
        </button>
      </div>

      {albums.length > 0 && (
        <Shelf title="Albums">
          {albums.map((album) => (
            <AlbumCard key={album.id} album={album} library={library} />
          ))}
        </Shelf>
      )}

      {songs.length === 0 && loading ? (
        <MusicSkeleton />
      ) : (
        <div className="mt-5">
          <h2 className="px-4 text-[15px] font-semibold">Tracks</h2>
          <div className="mt-1">
            <SongList songs={songs} library={library} variant="cover" />
          </div>
        </div>
      )}

      <div ref={sentinel} className="h-10" />
      {loading && songs.length > 0 && (
        <p className="pb-4 text-center text-xs text-white/30">Loading…</p>
      )}
    </div>
  );
}
