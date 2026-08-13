"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Download,
  Heart,
  ListPlus,
  Loader2,
  Play,
  Radio,
  Share2,
  Shuffle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Album, MusicLibrary, Song } from "@/lib/music-client";
import { fetchMix, formatTotal, musicFetch } from "@/lib/music-client";
import { useDownloads } from "@/lib/use-downloads";
import { useMusicPlayer } from "@/components/music/player-provider";
import { Cover, MusicSkeleton, MusicUnavailable } from "@/components/music/common";
import SongList from "@/components/music/song-list";
import AddToPlaylist from "@/components/music/add-to-playlist";
import MusicShareSheet from "@/components/music/music-share-sheet";

export default function AlbumView({
  albumId,
  library,
  highlightTrack,
}: {
  albumId: string;
  library: MusicLibrary;
  /** ?track= from a shared song link — the row is marked and scrolled to. */
  highlightTrack?: string | null;
}) {
  const player = useMusicPlayer();
  const { has, download } = useDownloads();
  const [album, setAlbum] = useState<Album | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [starred, setStarred] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // Progress of "download album": how many of its tracks are stored so far.
  const [downloading, setDownloading] = useState<number | null>(null);

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

  const downloadAlbum = useCallback(async () => {
    setDownloading(0);
    try {
      // Sequential on purpose: a Pi serving ten parallel full-track requests
      // starves the person who is actually listening.
      for (let i = 0; i < songs.length; i++) {
        await download(songs[i], library);
        setDownloading(i + 1);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDownloading(null);
    }
  }, [download, library, songs]);

  const startRadio = useCallback(async () => {
    try {
      const mix = await fetchMix(albumId, "album", library);
      if (mix.length) player.playQueue(mix, 0, library);
    } catch {
      /* the album itself is still playable from the button next to it */
    }
  }, [albumId, library, player]);

  if (error) return <MusicUnavailable message={error} library={library} />;
  if (!album) return <MusicSkeleton />;

  const allDownloaded =
    songs.length > 0 && songs.every((song) => has(song.id, library));

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

        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={startRadio}
            className="flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/60 transition hover:text-white"
          >
            <Radio size={14} />
            Radio
          </button>
          <button
            onClick={downloadAlbum}
            disabled={downloading !== null || allDownloaded}
            className={cn(
              "flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs transition",
              allDownloaded
                ? "text-emerald-400"
                : "text-white/60 hover:text-white disabled:opacity-60"
            )}
          >
            {downloading !== null ? (
              <Loader2 size={14} className="animate-spin" />
            ) : allDownloaded ? (
              <CheckCircle2 size={14} />
            ) : (
              <Download size={14} />
            )}
            {downloading !== null
              ? `${downloading}/${songs.length}`
              : allDownloaded
                ? "Downloaded"
                : "Download"}
          </button>
          <button
            onClick={() => setShareOpen(true)}
            className="flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/60 transition hover:text-white"
          >
            <Share2 size={14} />
            Share
          </button>
        </div>
      </div>

      <div className="mt-6">
        <SongList
          songs={songs}
          library={library}
          variant="track"
          highlightId={highlightTrack}
        />
      </div>

      <AddToPlaylist
        songIds={songs.map((s) => s.id)}
        library={library}
        open={addOpen}
        onClose={() => setAddOpen(false)}
      />

      <MusicShareSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        link={{ kind: "album", id: album.id, library }}
        title={album.name}
        subtitle={album.artist}
        coverArt={album.coverArt}
      />
    </div>
  );
}
