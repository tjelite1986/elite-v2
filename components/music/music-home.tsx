"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Download, Heart, ListMusic, Search, Shuffle, Tags, Users } from "lucide-react";
import type { Album, MusicLibrary, Song } from "@/lib/music-client";
import { musicFetch } from "@/lib/music-client";
import { useMusicPlayer } from "@/components/music/player-provider";
import {
  AlbumCard,
  LibrarySwitcher,
  MusicPageHeader,
  MusicSkeleton,
  MusicUnavailable,
  Shelf,
} from "@/components/music/common";
import SongList from "@/components/music/song-list";
import MusicGrab from "@/components/music/music-grab";
import ScanStatus from "@/components/music/scan-status";

interface HomeData {
  shelves: {
    newest: Album[];
    frequent: Album[];
    recent: Album[];
    random: Album[];
  };
  starredSongs: Song[];
}

// The /music landing page. First load is also what provisions this user's
// Navidrome account, so a failure here is where the link fallback surfaces.
export default function MusicHome({
  library,
  isAdmin,
}: {
  library: MusicLibrary;
  isAdmin: boolean;
}) {
  const player = useMusicPlayer();
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<{ message: string; reason?: string } | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`/api/music/home?library=${library}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !body || body.ok === false) {
          setError({
            message: body?.error || `Request failed (${res.status})`,
            reason: body?.reason,
          });
          return;
        }
        setData(body as HomeData);
      })
      .catch((e: Error) => !cancelled && setError({ message: e.message }));
    return () => {
      cancelled = true;
    };
  }, [library]);

  const shuffleAll = useCallback(async () => {
    try {
      const { songs } = await musicFetch<{ songs: Song[] }>(
        "/api/music/random?size=100",
        library
      );
      if (songs.length) player.playQueue(songs, 0, library);
    } catch {
      /* the button is a shortcut; failing it silently is fine */
    }
  }, [library, player]);

  if (error) {
    return (
      <MusicUnavailable
        message={error.message}
        reason={error.reason}
        library={library}
      />
    );
  }

  return (
    <div className="pb-8">
      <MusicPageHeader
        title="Music"
        subtitle={library === "kids" ? "Kids library" : null}
        right={<LibrarySwitcher library={library} basePath="/music" />}
      />

      <div className="flex flex-wrap gap-2 px-4">
        <button
          onClick={shuffleAll}
          className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/90"
        >
          <Shuffle size={16} />
          Shuffle all
        </button>
        <Link
          href={`/music/search?library=${library}`}
          className="flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm text-white/70 transition hover:text-white"
        >
          <Search size={16} />
          Search
        </Link>
        <Link
          href={`/music/artists?library=${library}`}
          className="flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm text-white/70 transition hover:text-white"
        >
          <Users size={16} />
          Artists
        </Link>
        <Link
          href={`/music/favorites?library=${library}`}
          className="flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm text-white/70 transition hover:text-white"
        >
          <Heart size={16} />
          Favourites
        </Link>
        <Link
          href={`/music/genres?library=${library}`}
          className="flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm text-white/70 transition hover:text-white"
        >
          <Tags size={16} />
          Genres
        </Link>
        <Link
          href="/music/downloads"
          className="flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm text-white/70 transition hover:text-white"
        >
          <Download size={16} />
          Downloads
        </Link>
      </div>

      <ScanStatus library={library} isAdmin={isAdmin} />

      {isAdmin && <MusicGrab library={library} />}

      {!data ? (
        <MusicSkeleton />
      ) : (
        <>
          <HomeShelf
            title="Recently added"
            albums={data.shelves.newest}
            library={library}
            href={`/music/albums?library=${library}&sort=newest`}
          />
          <HomeShelf
            title="Most played"
            albums={data.shelves.frequent}
            library={library}
            href={`/music/albums?library=${library}&sort=frequent`}
          />
          <HomeShelf
            title="Recently played"
            albums={data.shelves.recent}
            library={library}
            href={`/music/albums?library=${library}&sort=recent`}
          />
          <HomeShelf
            title="Something else"
            albums={data.shelves.random}
            library={library}
          />

          {data.starredSongs.length > 0 && (
            <section className="mt-6">
              <div className="flex items-baseline justify-between px-4">
                <h2 className="text-[15px] font-semibold">Your favourites</h2>
                <Link
                  href={`/music/favorites?library=${library}`}
                  className="text-xs text-white/40 hover:text-white"
                >
                  See all
                </Link>
              </div>
              <div className="mt-2">
                <SongList
                  songs={data.starredSongs}
                  library={library}
                  variant="cover"
                />
              </div>
            </section>
          )}

          {!data.shelves.newest.length && !data.starredSongs.length && (
            <div className="px-4 py-16 text-center text-white/40">
              <ListMusic size={36} className="mx-auto text-white/20" />
              <p className="mt-3 text-sm">
                This library is empty. Drop files into it, or let Navidrome scan.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function HomeShelf({
  title,
  albums,
  library,
  href,
}: {
  title: string;
  albums: Album[];
  library: MusicLibrary;
  href?: string;
}) {
  if (!albums.length) return null;
  return (
    <Shelf title={title} href={href}>
      {albums.map((album) => (
        <AlbumCard key={album.id} album={album} library={library} />
      ))}
    </Shelf>
  );
}
