"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Disc3, ListMusic, Music4, Play, User } from "lucide-react";
import type { MusicLibrary, Song } from "@/lib/music-client";
import { formatTotal, musicFetch } from "@/lib/music-client";
import type { MusicLink } from "@/lib/music-share";
import { musicPath } from "@/lib/music-share";
import { useOptionalMusicPlayer } from "@/components/music/player-provider";
import { Cover } from "@/components/music/common";

interface ResolvedItem {
  kind: MusicLink["kind"];
  id: string;
  title: string;
  subtitle: string | null;
  coverArt: string | null;
  songCount: number | null;
  duration: number | null;
}

// Module-level memo: the same shared link can appear in several messages, and
// each render would otherwise cost a Subsonic call.
const memo = new Map<string, ResolvedItem | null>();

const ICONS = {
  song: Music4,
  album: Disc3,
  artist: User,
  playlist: ListMusic,
} as const;

/**
 * The card a shared /music link turns into inside a chat. It plays in place —
 * the point of sharing a track is that the other person can hear it without
 * leaving the conversation.
 */
export default function MusicLinkCard({
  link,
  url,
}: {
  link: MusicLink;
  /** The original text of the link, shown if the card cannot be built. */
  url?: string;
}) {
  const player = useOptionalMusicPlayer();
  const key = `${link.library}:${link.kind}:${link.id}`;
  const [item, setItem] = useState<ResolvedItem | null>(memo.get(key) ?? null);
  const [done, setDone] = useState(memo.has(key));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (memo.has(key)) {
      setItem(memo.get(key) ?? null);
      setDone(true);
      return;
    }
    let cancelled = false;
    musicFetch<{ item: ResolvedItem }>(
      `/api/music/resolve?kind=${link.kind}&id=${encodeURIComponent(link.id)}`,
      link.library
    )
      .then((d) => {
        memo.set(key, d.item);
        if (!cancelled) {
          setItem(d.item);
          setDone(true);
        }
      })
      .catch(() => {
        // A link to a track that has since been removed (or a library this user
        // has no account on) stays a plain link rather than an error card.
        memo.set(key, null);
        if (!cancelled) setDone(true);
      });
    return () => {
      cancelled = true;
    };
  }, [key, link.id, link.kind, link.library]);

  // The chat hides the raw URL when the message is only a music link, so this
  // component owns both the waiting state and the failure state — returning
  // nothing would turn the message into an empty bubble.
  if (!done) {
    return (
      <div className="mt-1.5 h-16 animate-pulse rounded-xl border border-white/10 bg-black/20" />
    );
  }
  if (!item) {
    return (
      <Link
        href={musicPath(link)}
        className="mt-1.5 block break-all text-sm text-blue-300 underline underline-offset-2"
      >
        {url ?? "Open in Music"}
      </Link>
    );
  }

  const Icon = ICONS[item.kind];

  const play = async () => {
    if (!player) return;
    setBusy(true);
    try {
      const songs = await songsFor(link, item, link.library);
      if (songs.length) player.playQueue(songs, 0, link.library);
    } catch {
      /* the card stays; the link still opens the section */
    } finally {
      setBusy(false);
    }
  };

  const meta = [
    item.songCount
      ? `${item.songCount} ${item.songCount === 1 ? "track" : "tracks"}`
      : null,
    formatTotal(item.duration) || null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="mt-1.5 flex items-center gap-3 overflow-hidden rounded-xl border border-white/15 bg-black/20 p-2"
    >
      <Link href={musicPath(link)} className="shrink-0">
        <Cover
          coverArt={item.coverArt}
          library={link.library}
          size={96}
          rounded="rounded-lg"
          className="h-12 w-12"
          icon={<Icon size={18} />}
        />
      </Link>
      <Link href={musicPath(link)} className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.title}</p>
        <p className="truncate text-xs text-white/45">
          {[item.subtitle, meta].filter(Boolean).join(" · ")}
        </p>
      </Link>
      <button
        onClick={play}
        disabled={busy || !player}
        aria-label={`Play ${item.title}`}
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-black transition hover:bg-white/90 disabled:opacity-50"
      >
        <Play size={15} fill="currentColor" />
      </button>
    </div>
  );
}

/** The tracks a card should queue, per kind. */
async function songsFor(
  link: MusicLink,
  item: ResolvedItem,
  library: MusicLibrary
): Promise<Song[]> {
  if (link.kind === "song") {
    const { song } = await musicFetch<{ song: Song }>(
      `/api/music/songs/${encodeURIComponent(link.id)}`,
      library
    );
    return song ? [song] : [];
  }
  if (link.kind === "album") {
    const { songs } = await musicFetch<{ songs: Song[] }>(
      `/api/music/albums/${encodeURIComponent(link.id)}`,
      library
    );
    return songs;
  }
  if (link.kind === "playlist") {
    const { songs } = await musicFetch<{ songs: Song[] }>(
      `/api/music/playlists/${encodeURIComponent(link.id)}`,
      library
    );
    return songs;
  }
  const { topSongs } = await musicFetch<{ topSongs: Song[] }>(
    `/api/music/artists/${encodeURIComponent(link.id)}`,
    library
  );
  void item;
  return topSongs ?? [];
}
