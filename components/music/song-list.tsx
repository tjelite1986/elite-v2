"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  Disc3,
  Heart,
  ListPlus,
  MoreVertical,
  Play,
  Trash2,
  User,
  Volume2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useBackDismiss } from "@/lib/use-back-dismiss";
import type { MusicLibrary, Song } from "@/lib/music-client";
import { formatDuration, musicFetch } from "@/lib/music-client";
import { useMusicPlayer } from "@/components/music/player-provider";
import { Cover } from "@/components/music/common";
import AddToPlaylist from "@/components/music/add-to-playlist";

// The one song list used by every music page. Tapping a row starts the whole
// list as the queue from that position, which is what makes an album, a
// playlist and a set of search results all behave the same way.
export default function SongList({
  songs,
  library,
  variant = "track",
  onRemove,
  onStarChange,
}: {
  songs: Song[];
  library: MusicLibrary;
  /** "track" shows the track number (album view), "cover" shows artwork. */
  variant?: "track" | "cover";
  /** Present on the playlist view, where a row can be taken out of the list. */
  onRemove?: (index: number) => void;
  onStarChange?: (songId: string, starred: boolean) => void;
}) {
  const player = useMusicPlayer();
  const [menuFor, setMenuFor] = useState<{ song: Song; index: number } | null>(null);
  const [playlistFor, setPlaylistFor] = useState<Song | null>(null);
  const [starred, setStarred] = useState<Record<string, boolean>>({});

  const isStarred = useCallback(
    (song: Song) => starred[song.id] ?? song.starred,
    [starred]
  );

  const toggleStar = useCallback(
    async (song: Song) => {
      const next = !isStarred(song);
      // Optimistic: the heart is the whole feedback, and a failed call rolls
      // it back below.
      setStarred((s) => ({ ...s, [song.id]: next }));
      try {
        await musicFetch("/api/music/star", library, {
          method: "POST",
          body: JSON.stringify({ id: song.id, type: "song", starred: next }),
        });
        player.markStarred(song.id, next);
        onStarChange?.(song.id, next);
      } catch {
        setStarred((s) => ({ ...s, [song.id]: !next }));
      }
    },
    [isStarred, library, player, onStarChange]
  );

  return (
    <>
      <ul className="divide-y divide-white/5">
        {songs.map((song, i) => {
          const active = player.current?.id === song.id;
          return (
            <li key={`${song.id}-${i}`} className="flex items-center gap-3 px-4 py-2">
              <button
                onClick={() => player.playQueue(songs, i, library)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                {variant === "cover" ? (
                  <Cover
                    coverArt={song.coverArt}
                    library={library}
                    size={96}
                    rounded="rounded"
                    className="h-10 w-10 shrink-0"
                  />
                ) : (
                  <span className="w-6 shrink-0 text-center text-xs tabular-nums text-white/30">
                    {active ? (
                      <Volume2 size={14} className="mx-auto text-[var(--accent,#3b82f6)]" />
                    ) : (
                      song.track ?? i + 1
                    )}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block truncate text-sm",
                      active && "text-[var(--accent,#3b82f6)]"
                    )}
                  >
                    {song.title}
                  </span>
                  <span className="block truncate text-xs text-white/40">
                    {[song.artist, variant === "cover" ? song.album : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </button>

              <span className="shrink-0 text-xs tabular-nums text-white/30">
                {formatDuration(song.duration)}
              </span>
              <button
                onClick={() => toggleStar(song)}
                aria-label={isStarred(song) ? "Unfavourite" : "Favourite"}
                className={cn(
                  "shrink-0 rounded p-1 transition",
                  isStarred(song)
                    ? "text-rose-400"
                    : "text-white/20 hover:text-white/60"
                )}
              >
                <Heart size={15} fill={isStarred(song) ? "currentColor" : "none"} />
              </button>
              <button
                onClick={() => setMenuFor({ song, index: i })}
                aria-label="More"
                className="shrink-0 rounded p-1 text-white/30 transition hover:text-white"
              >
                <MoreVertical size={16} />
              </button>
            </li>
          );
        })}
      </ul>

      {menuFor && (
        <SongMenu
          song={menuFor.song}
          index={menuFor.index}
          library={library}
          onClose={() => setMenuFor(null)}
          onAddToPlaylist={() => {
            setPlaylistFor(menuFor.song);
            setMenuFor(null);
          }}
          onRemove={onRemove}
        />
      )}

      <AddToPlaylist
        songIds={playlistFor ? [playlistFor.id] : []}
        library={library}
        open={Boolean(playlistFor)}
        onClose={() => setPlaylistFor(null)}
      />
    </>
  );
}

function SongMenu({
  song,
  index,
  library,
  onClose,
  onAddToPlaylist,
  onRemove,
}: {
  song: Song;
  index: number;
  library: MusicLibrary;
  onClose: () => void;
  onAddToPlaylist: () => void;
  onRemove?: (index: number) => void;
}) {
  const player = useMusicPlayer();
  useBackDismiss(true, onClose);

  const Row = ({
    icon,
    label,
    onClick,
    href,
    danger,
  }: {
    icon: React.ReactNode;
    label: string;
    onClick?: () => void;
    href?: string;
    danger?: boolean;
  }) => {
    const className = cn(
      "flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition hover:bg-white/5",
      danger && "text-rose-400"
    );
    return href ? (
      <Link href={href} onClick={onClose} className={className}>
        <span className="text-white/50">{icon}</span>
        {label}
      </Link>
    ) : (
      <button
        onClick={() => {
          onClick?.();
          onClose();
        }}
        className={className}
      >
        <span className={danger ? "text-rose-400" : "text-white/50"}>{icon}</span>
        {label}
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full rounded-t-2xl border-t border-white/10 bg-[#16161c] pb-[env(safe-area-inset-bottom)]"
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <Cover
            coverArt={song.coverArt}
            library={library}
            size={96}
            rounded="rounded"
            className="h-10 w-10 shrink-0"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{song.title}</p>
            <p className="truncate text-xs text-white/40">{song.artist}</p>
          </div>
        </div>

        <Row
          icon={<Play size={17} />}
          label="Play next"
          onClick={() => player.playAfterCurrent([song], library)}
        />
        <Row
          icon={<ListPlus size={17} />}
          label="Add to queue"
          onClick={() => player.enqueue([song], library)}
        />
        <Row icon={<ListPlus size={17} />} label="Add to playlist" onClick={onAddToPlaylist} />
        {song.albumId && (
          <Row
            icon={<Disc3 size={17} />}
            label="Go to album"
            href={`/music/albums/${encodeURIComponent(song.albumId)}?library=${library}`}
          />
        )}
        {song.artistId && (
          <Row
            icon={<User size={17} />}
            label="Go to artist"
            href={`/music/artists/${encodeURIComponent(song.artistId)}?library=${library}`}
          />
        )}
        {onRemove && (
          <Row
            icon={<Trash2 size={17} />}
            label="Remove from playlist"
            danger
            onClick={() => onRemove(index)}
          />
        )}
      </div>
    </div>
  );
}
