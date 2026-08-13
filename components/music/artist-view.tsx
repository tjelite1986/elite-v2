"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Heart, Play, Radio, Share2, Shuffle, User } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Album, Artist, MusicLibrary, Song } from "@/lib/music-client";
import { fetchMix, musicFetch } from "@/lib/music-client";
import MusicShareSheet from "@/components/music/music-share-sheet";
import { useMusicPlayer } from "@/components/music/player-provider";
import {
  AlbumCard,
  Cover,
  MusicSkeleton,
  MusicUnavailable,
  Shelf,
} from "@/components/music/common";
import SongList from "@/components/music/song-list";

interface ArtistData {
  artist: Artist;
  albums: Album[];
  topSongs: Song[];
  biography: string | null;
  similar: Artist[];
}

export default function ArtistView({
  artistId,
  library,
}: {
  artistId: string;
  library: MusicLibrary;
}) {
  const player = useMusicPlayer();
  const [data, setData] = useState<ArtistData | null>(null);
  const [starred, setStarred] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bioOpen, setBioOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    musicFetch<ArtistData>(
      `/api/music/artists/${encodeURIComponent(artistId)}`,
      library
    )
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setStarred(d.artist.starred);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [artistId, library]);

  if (error) return <MusicUnavailable message={error} library={library} />;
  if (!data) return <MusicSkeleton />;

  const toggleStar = async () => {
    const next = !starred;
    setStarred(next);
    try {
      await musicFetch("/api/music/star", library, {
        method: "POST",
        body: JSON.stringify({ id: data.artist.id, type: "artist", starred: next }),
      });
    } catch {
      setStarred(!next);
    }
  };

  return (
    <div className="pb-8">
      <div className="flex flex-col items-center px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)]">
        <Cover
          coverArt={data.artist.coverArt}
          library={library}
          size={600}
          rounded="rounded-full"
          className="h-36 w-36 shadow-2xl"
          icon={<User size={44} />}
        />
        <h1 className="mt-4 text-center text-xl font-semibold">{data.artist.name}</h1>
        <p className="text-xs text-white/35">{data.albums.length} albums</p>

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={() => data.topSongs.length && player.playQueue(data.topSongs, 0, library)}
            disabled={!data.topSongs.length}
            className="flex items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-40"
          >
            <Play size={16} fill="currentColor" />
            Play
          </button>
          <button
            onClick={() => {
              const shuffled = [...data.topSongs].sort(() => Math.random() - 0.5);
              if (shuffled.length) player.playQueue(shuffled, 0, library);
            }}
            aria-label="Shuffle artist"
            className="rounded-full border border-white/10 p-2.5 text-white/70 transition hover:text-white"
          >
            <Shuffle size={16} />
          </button>
          <button
            onClick={toggleStar}
            aria-label={starred ? "Unfavourite artist" : "Favourite artist"}
            className={cn(
              "rounded-full border border-white/10 p-2.5 transition",
              starred ? "text-rose-400" : "text-white/70 hover:text-white"
            )}
          >
            <Heart size={16} fill={starred ? "currentColor" : "none"} />
          </button>
          <button
            onClick={async () => {
              const mix = await fetchMix(data.artist.id, "artist", library).catch(
                () => [] as Song[]
              );
              if (mix.length) player.playQueue(mix, 0, library);
            }}
            aria-label="Start artist radio"
            className="rounded-full border border-white/10 p-2.5 text-white/70 transition hover:text-white"
          >
            <Radio size={16} />
          </button>
          <button
            onClick={() => setShareOpen(true)}
            aria-label="Share artist"
            className="rounded-full border border-white/10 p-2.5 text-white/70 transition hover:text-white"
          >
            <Share2 size={16} />
          </button>
        </div>
      </div>

      <MusicShareSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        link={{ kind: "artist", id: data.artist.id, library }}
        title={data.artist.name}
        subtitle={`${data.albums.length} albums`}
        coverArt={data.artist.coverArt}
      />

      {data.biography && (
        <div className="px-4 pt-5">
          <p
            className={cn(
              "text-sm leading-relaxed text-white/55",
              !bioOpen && "line-clamp-3"
            )}
          >
            {data.biography}
          </p>
          <button
            onClick={() => setBioOpen((o) => !o)}
            className="mt-1 text-xs text-white/40 hover:text-white"
          >
            {bioOpen ? "Show less" : "Read more"}
          </button>
        </div>
      )}

      {data.topSongs.length > 0 && (
        <section className="mt-5">
          <h2 className="px-4 text-[15px] font-semibold">Popular</h2>
          <div className="mt-2">
            <SongList songs={data.topSongs} library={library} variant="cover" />
          </div>
        </section>
      )}

      {data.albums.length > 0 && (
        <Shelf title="Albums">
          {data.albums.map((album) => (
            <AlbumCard key={album.id} album={album} library={library} />
          ))}
        </Shelf>
      )}

      {data.similar.length > 0 && (
        <Shelf title="Similar artists">
          {data.similar.slice(0, 15).map((a) => (
            // Link, not <a>: a full navigation would tear down the layout and
            // stop playback.
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
    </div>
  );
}
