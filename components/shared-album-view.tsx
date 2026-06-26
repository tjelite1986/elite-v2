"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useBackDismiss } from "@/lib/use-back-dismiss";

interface Item {
  id: number;
  filename: string;
  mime_type: string;
  media_version: number;
}

// Read-only public gallery for a shared album (no auth, no app chrome).
export default function SharedAlbumView({
  token,
  name,
  items,
}: {
  token: string;
  name: string;
  items: Item[];
}) {
  const [index, setIndex] = useState<number | null>(null);
  useBackDismiss(index !== null, () => setIndex(null));

  const src = (id: number, variant: string, v: number) =>
    `/api/gallery/shared/${token}/media/${id}?variant=${variant}&v=${v}`;

  const open = index !== null ? items[index] : null;
  const step = (d: number) =>
    setIndex((i) =>
      i === null ? i : Math.max(0, Math.min(items.length - 1, i + d))
    );

  return (
    <main className="mx-auto min-h-[100dvh] max-w-5xl px-4 py-10 text-white">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-wide text-white/40">
          Shared album
        </div>
        <h1 className="text-2xl font-semibold">{name}</h1>
        <p className="mt-1 text-sm text-white/50">
          {items.length} photo{items.length === 1 ? "" : "s"}
        </p>
      </header>

      {items.length === 0 ? (
        <p className="text-white/50">This album is empty.</p>
      ) : (
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-5">
          {items.map((it, i) => (
            <button
              key={it.id}
              onClick={() => setIndex(i)}
              className="aspect-square overflow-hidden rounded-lg bg-white/5"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src(it.id, "thumb", it.media_version)}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/95">
          <button
            onClick={() => setIndex(null)}
            className="absolute right-4 top-4 flex size-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
            aria-label="Close"
          >
            <X size={20} />
          </button>
          {index! > 0 && (
            <button
              onClick={() => step(-1)}
              className="absolute left-3 flex size-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
              aria-label="Previous"
            >
              <ChevronLeft size={24} />
            </button>
          )}
          {index! < items.length - 1 && (
            <button
              onClick={() => step(1)}
              className="absolute right-3 flex size-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
              aria-label="Next"
            >
              <ChevronRight size={24} />
            </button>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src(open.id, "preview", open.media_version)}
            alt=""
            className="max-h-[90vh] max-w-[92vw] object-contain"
          />
        </div>
      )}

      <footer className="mt-10 text-center text-xs text-white/30">
        Elite
      </footer>
    </main>
  );
}
