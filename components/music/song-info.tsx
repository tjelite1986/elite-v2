"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useBackDismiss } from "@/lib/use-back-dismiss";
import type { MusicLibrary, Song } from "@/lib/music-client";
import { formatDuration, musicFetch } from "@/lib/music-client";
import { formatBytes } from "@/lib/music-offline";
import { Cover } from "@/components/music/common";

interface Detail {
  contentType: string | null;
  samplingRate: number | null;
  bitDepth: number | null;
  channelCount: number | null;
  bpm: number | null;
  created: string | null;
  path: string | null;
  comment: string | null;
  musicBrainzId: string | null;
}

// "Info" for a track: the tags and the technical facts the lists leave out.
// The extra call is only made when the sheet is actually opened.
export default function SongInfo({
  song,
  library,
  onClose,
}: {
  song: Song;
  library: MusicLibrary;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [full, setFull] = useState<Song>(song);

  useBackDismiss(true, onClose);

  useEffect(() => {
    let cancelled = false;
    musicFetch<{ song: Song; detail: Detail }>(
      `/api/music/songs/${encodeURIComponent(song.id)}`,
      library
    )
      .then((d) => {
        if (cancelled) return;
        setFull(d.song);
        setDetail(d.detail);
      })
      .catch(() => {
        /* the row data already on screen is enough to render the sheet */
      });
    return () => {
      cancelled = true;
    };
  }, [library, song.id]);

  const quality = [
    full.suffix?.toUpperCase(),
    full.bitRate ? `${full.bitRate} kbps` : null,
    detail?.samplingRate ? `${(detail.samplingRate / 1000).toFixed(1)} kHz` : null,
    detail?.bitDepth ? `${detail.bitDepth}-bit` : null,
    detail?.channelCount === 1 ? "Mono" : detail?.channelCount === 2 ? "Stereo" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const rows: [string, string | null][] = [
    ["Artist", full.artist],
    ["Album", full.album],
    ["Track", full.track ? String(full.track) : null],
    ["Disc", full.discNumber ? String(full.discNumber) : null],
    ["Year", full.year ? String(full.year) : null],
    ["Genre", full.genre],
    ["Length", formatDuration(full.duration)],
    ["Quality", quality || null],
    ["Size", full.size ? formatBytes(full.size) : null],
    ["BPM", detail?.bpm ? String(detail.bpm) : null],
    ["Plays", full.playCount != null ? String(full.playCount) : null],
    ["Added", detail?.created ? new Date(detail.created).toLocaleDateString() : null],
    ["Comment", detail?.comment ?? null],
    ["File", detail?.path ?? null],
  ];

  return (
    <div className="fixed inset-0 z-[110] flex items-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border-t border-white/10 bg-[#16161c] pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:max-w-sm sm:rounded-2xl sm:border">
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <Cover
            coverArt={full.coverArt}
            library={library}
            size={96}
            rounded="rounded"
            className="h-11 w-11 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{full.title}</p>
            <p className="truncate text-xs text-white/40">{full.artist}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-white/40 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <dl className="divide-y divide-white/5">
          {rows
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <div key={label} className="flex gap-4 px-4 py-2.5 text-sm">
                <dt className="w-24 shrink-0 text-white/40">{label}</dt>
                <dd className="min-w-0 flex-1 break-words">{value}</dd>
              </div>
            ))}
        </dl>
      </div>
    </div>
  );
}
