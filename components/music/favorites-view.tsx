"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Heart, Play, User } from "lucide-react";
import type { Album, Artist, MusicLibrary, Song } from "@/lib/music-client";
import { musicFetch } from "@/lib/music-client";
import { useMusicPlayer } from "@/components/music/player-provider";
import {
  AlbumCard,
  Cover,
  LibrarySwitcher,
  MusicPageHeader,
  MusicSkeleton,
  MusicUnavailable,
  Shelf,
} from "@/components/music/common";
import SongList from "@/components/music/song-list";

export default function FavoritesView({ library }: { library: MusicLibrary }) {
  const player = useMusicPlayer();
  const [data, setData] = useState<{
    artists: Artist[];
    albums: Album[];
    songs: Song[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    musicFetch<{ artists: Artist[]; albums: Album[]; songs: Song[] }>(
      "/api/music/favorites",
      library
    )
      .then((d) => !cancelled && setData(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [library]);

  if (error) return <MusicUnavailable message={error} library={library} />;

  return (
    <div className="pb-8">
      <MusicPageHeader
        title="Favourites"
        subtitle="Starred in Navidrome"
        right={<LibrarySwitcher library={library} basePath="/music/favorites" />}
      />

      {!data ? (
        <MusicSkeleton />
      ) : !data.songs.length && !data.albums.length && !data.artists.length ? (
        <div className="px-4 py-16 text-center text-white/40">
          <Heart size={36} className="mx-auto text-white/20" />
          <p className="mt-3 text-sm">
            Nothing starred yet. Tap the heart on a song, album or artist.
          </p>
        </div>
      ) : (
        <>
          {data.albums.length > 0 && (
            <Shelf title="Albums">
              {data.albums.map((album) => (
                <AlbumCard key={album.id} album={album} library={library} />
              ))}
            </Shelf>
          )}

          {data.artists.length > 0 && (
            <Shelf title="Artists">
              {data.artists.map((a) => (
                <Link
                  key={a.id}
                  href={`/music/artists/${encodeURIComponent(a.id)}?library=${library}`}
                  className="w-24 shrink-0 text-center"
                >
                  <Cover
                    coverArt={a.coverArt}
                    library={library}
                    size={200}
                    rounded="rounded-full"
                    className="h-24 w-24"
                    icon={<User size={24} />}
                  />
                  <p className="mt-1.5 truncate text-[11px] text-white/60">{a.name}</p>
                </Link>
              ))}
            </Shelf>
          )}

          {data.songs.length > 0 && (
            <section className="mt-6">
              <div className="flex items-center justify-between px-4">
                <h2 className="text-[15px] font-semibold">Songs</h2>
                <button
                  onClick={() => player.playQueue(data.songs, 0, library)}
                  className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-medium text-black"
                >
                  <Play size={13} fill="currentColor" />
                  Play all
                </button>
              </div>
              <div className="mt-2">
                <SongList songs={data.songs} library={library} variant="cover" />
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
