"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Album, MusicLibrary } from "@/lib/music-client";
import { musicFetch } from "@/lib/music-client";
import {
  Cover,
  LibrarySwitcher,
  MusicPageHeader,
  MusicSkeleton,
  MusicUnavailable,
} from "@/components/music/common";

const SORTS = [
  { id: "name", label: "A–Z" },
  { id: "artist", label: "By artist" },
  { id: "newest", label: "Newest" },
  { id: "frequent", label: "Most played" },
  { id: "recent", label: "Recently played" },
  { id: "starred", label: "Favourites" },
  { id: "year", label: "By year" },
] as const;

const PAGE_SIZE = 60;

// The album grid. Sort lives in the URL so Back from an album restores the
// exact view you left, rather than resetting to A–Z.
export default function AlbumsBrowser({
  library,
  sort,
}: {
  library: MusicLibrary;
  sort: string;
}) {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<{ message: string; reason?: string } | null>(
    null
  );
  const sentinel = useRef<HTMLDivElement | null>(null);

  const load = useCallback(
    async (offset: number) => {
      try {
        const data = await musicFetch<{ albums: Album[]; hasMore: boolean }>(
          `/api/music/albums?sort=${sort}&size=${PAGE_SIZE}&offset=${offset}`,
          library
        );
        setAlbums((prev) => (offset === 0 ? data.albums : [...prev, ...data.albums]));
        setHasMore(data.hasMore);
      } catch (e) {
        setError({ message: (e as Error).message });
      } finally {
        setLoading(false);
      }
    },
    [library, sort]
  );

  useEffect(() => {
    setAlbums([]);
    setLoading(true);
    setError(null);
    load(0);
  }, [load]);

  // Infinite scroll: 700+ albums is too many for one request, and a "load more"
  // button in a grid this dense is just an extra tap.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || loading) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setLoading(true);
        load(albums.length);
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [albums.length, hasMore, loading, load]);

  if (error) {
    return (
      <MusicUnavailable message={error.message} reason={error.reason} library={library} />
    );
  }

  return (
    <div className="pb-8">
      <MusicPageHeader
        title="Albums"
        right={<LibrarySwitcher library={library} basePath="/music/albums" />}
      />

      <div className="flex gap-2 overflow-x-auto px-4 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {SORTS.map((s) => (
          <Link
            key={s.id}
            href={`/music/albums?library=${library}&sort=${s.id}`}
            scroll={false}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1 text-xs transition",
              s.id === sort
                ? "border-white bg-white text-black"
                : "border-white/10 text-white/50 hover:text-white"
            )}
          >
            {s.label}
          </Link>
        ))}
      </div>

      {albums.length === 0 && loading ? (
        <MusicSkeleton />
      ) : (
        <div className="grid grid-cols-2 gap-x-3 gap-y-5 px-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {albums.map((album) => (
            <Link
              key={album.id}
              href={`/music/albums/${encodeURIComponent(album.id)}?library=${library}`}
              className="group block"
            >
              <Cover
                coverArt={album.coverArt}
                library={library}
                size={300}
                className="aspect-square w-full transition group-hover:opacity-85"
              />
              <p className="mt-1.5 truncate text-[13px] font-medium">{album.name}</p>
              <p className="truncate text-[11px] text-white/40">
                {album.artist}
                {album.year ? ` · ${album.year}` : ""}
              </p>
            </Link>
          ))}
        </div>
      )}

      <div ref={sentinel} className="h-10" />
      {loading && albums.length > 0 && (
        <p className="pb-4 text-center text-xs text-white/30">Loading…</p>
      )}
    </div>
  );
}
