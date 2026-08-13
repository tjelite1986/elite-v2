"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Tags } from "lucide-react";
import type { MusicLibrary } from "@/lib/music-client";
import { musicFetch } from "@/lib/music-client";
import {
  LibrarySwitcher,
  MusicPageHeader,
  MusicSkeleton,
  MusicUnavailable,
} from "@/components/music/common";

interface Genre {
  name: string;
  songCount: number;
  albumCount: number;
}

// Every genre in the library, biggest first — the order the API returns them in,
// because an alphabetical list buries the two or three genres that actually
// hold the library.
export default function GenresBrowser({ library }: { library: MusicLibrary }) {
  const [genres, setGenres] = useState<Genre[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setGenres(null);
    setError(null);
    musicFetch<{ genres: Genre[] }>("/api/music/genres", library)
      .then((d) => !cancelled && setGenres(d.genres))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [library]);

  if (error) return <MusicUnavailable message={error} library={library} />;

  return (
    <div className="pb-8">
      <MusicPageHeader
        title="Genres"
        right={<LibrarySwitcher library={library} basePath="/music/genres" />}
      />

      {!genres ? (
        <MusicSkeleton />
      ) : genres.length === 0 ? (
        <div className="px-4 py-16 text-center text-white/40">
          <Tags size={36} className="mx-auto text-white/20" />
          <p className="mt-3 text-sm">Nothing in this library carries a genre tag.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-3 lg:grid-cols-4">
          {genres.map((genre, i) => (
            <Link
              key={genre.name}
              href={`/music/genres/${encodeURIComponent(genre.name)}?library=${library}`}
              className="relative overflow-hidden rounded-xl px-3 py-4 transition hover:brightness-125"
              style={{ background: gradientFor(genre.name, i) }}
            >
              <p className="truncate text-sm font-semibold">{genre.name}</p>
              <p className="mt-0.5 text-[11px] text-white/70">
                {genre.songCount} {genre.songCount === 1 ? "track" : "tracks"}
                {genre.albumCount ? ` · ${genre.albumCount} albums` : ""}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// A stable colour per genre: the name's hash picks the hue, so "Rock" is the
// same shade on every device and after every rescan.
function gradientFor(name: string, index: number): string {
  let hash = index * 37;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${hash} 45% 28%), hsl(${(hash + 40) % 360} 40% 18%))`;
}
