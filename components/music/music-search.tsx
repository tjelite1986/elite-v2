"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, User } from "lucide-react";
import type { Album, Artist, MusicLibrary, Song } from "@/lib/music-client";
import { musicFetch } from "@/lib/music-client";
import {
  AlbumCard,
  Cover,
  LibrarySwitcher,
  MusicPageHeader,
  MusicUnavailable,
  Shelf,
} from "@/components/music/common";
import SongList from "@/components/music/song-list";

// Search across artists, albums and songs. The query is mirrored into the URL
// so Back from a result restores the search instead of an empty box.
export default function MusicSearch({
  library,
  initialQuery,
}: {
  library: MusicLibrary;
  initialQuery: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<{
    artists: Artist[];
    albums: Album[];
    songs: Song[];
  } | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const run = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) {
        setResults(null);
        return;
      }
      const mine = ++seq.current;
      setSearching(true);
      try {
        const data = await musicFetch<{
          artists: Artist[];
          albums: Album[];
          songs: Song[];
        }>(`/api/music/search?q=${encodeURIComponent(trimmed)}`, library);
        // Ignore a slow response that a newer keystroke has already replaced.
        if (mine === seq.current) setResults(data);
      } catch (e) {
        if (mine === seq.current) setError((e as Error).message);
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    },
    [library]
  );

  // Debounced as you type; the URL is only rewritten once typing settles.
  useEffect(() => {
    const t = setTimeout(() => {
      run(query);
      const url = query.trim()
        ? `/music/search?library=${library}&q=${encodeURIComponent(query.trim())}`
        : `/music/search?library=${library}`;
      router.replace(url, { scroll: false });
    }, 300);
    return () => clearTimeout(t);
  }, [query, run, router, library]);

  if (error) return <MusicUnavailable message={error} library={library} />;

  const empty =
    results &&
    !results.artists.length &&
    !results.albums.length &&
    !results.songs.length;

  return (
    <div className="pb-8">
      <MusicPageHeader
        title="Search"
        right={<LibrarySwitcher library={library} basePath="/music/search" />}
      />

      <div className="relative px-4 pb-3">
        <Search
          size={15}
          className="pointer-events-none absolute left-7 top-1/2 -translate-y-1/2 text-white/30"
        />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Artists, albums, songs"
          className="w-full rounded-full border border-white/10 bg-black/30 py-2 pl-9 pr-3 text-sm outline-none focus:border-white/30"
        />
      </div>

      {searching && !results && (
        <p className="px-4 py-8 text-center text-sm text-white/40">Searching…</p>
      )}

      {empty && (
        <p className="px-4 py-12 text-center text-sm text-white/40">
          Nothing matched “{query.trim()}”.
        </p>
      )}

      {results && (
        <>
          {results.artists.length > 0 && (
            <Shelf title="Artists">
              {results.artists.map((a) => (
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

          {results.albums.length > 0 && (
            <Shelf title="Albums">
              {results.albums.map((album) => (
                <AlbumCard key={album.id} album={album} library={library} />
              ))}
            </Shelf>
          )}

          {results.songs.length > 0 && (
            <section className="mt-6">
              <h2 className="px-4 text-[15px] font-semibold">Songs</h2>
              <div className="mt-2">
                <SongList songs={results.songs} library={library} variant="cover" />
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
