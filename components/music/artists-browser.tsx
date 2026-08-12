"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, User } from "lucide-react";
import type { Artist, MusicLibrary } from "@/lib/music-client";
import { musicFetch } from "@/lib/music-client";
import {
  Cover,
  LibrarySwitcher,
  MusicPageHeader,
  MusicSkeleton,
  MusicUnavailable,
} from "@/components/music/common";

// Every artist in one list with a client-side filter — the whole index is a
// single cheap call, so filtering locally beats a round trip per keystroke.
export default function ArtistsBrowser({ library }: { library: MusicLibrary }) {
  const [artists, setArtists] = useState<Artist[] | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setArtists(null);
    musicFetch<{ artists: Artist[] }>("/api/music/artists", library)
      .then((d) => !cancelled && setArtists(d.artists))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [library]);

  const shown = useMemo(() => {
    if (!artists) return [];
    const q = filter.trim().toLowerCase();
    return q ? artists.filter((a) => a.name.toLowerCase().includes(q)) : artists;
  }, [artists, filter]);

  if (error) return <MusicUnavailable message={error} library={library} />;

  return (
    <div className="pb-8">
      <MusicPageHeader
        title="Artists"
        subtitle={artists ? `${artists.length} artists` : null}
        right={<LibrarySwitcher library={library} basePath="/music/artists" />}
      />

      <div className="relative px-4 pb-3">
        <Search
          size={15}
          className="pointer-events-none absolute left-7 top-1/2 -translate-y-1/2 text-white/30"
        />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter artists"
          className="w-full rounded-full border border-white/10 bg-black/30 py-2 pl-9 pr-3 text-sm outline-none focus:border-white/30"
        />
      </div>

      {!artists ? (
        <MusicSkeleton />
      ) : (
        <ul className="divide-y divide-white/5">
          {shown.map((artist) => (
            <li key={artist.id}>
              <Link
                href={`/music/artists/${encodeURIComponent(artist.id)}?library=${library}`}
                className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-white/5"
              >
                <Cover
                  coverArt={artist.coverArt}
                  library={library}
                  size={96}
                  rounded="rounded-full"
                  className="h-11 w-11 shrink-0"
                  icon={<User size={18} />}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{artist.name}</span>
                  <span className="block text-xs text-white/40">
                    {artist.albumCount ?? 0} albums
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
