"use client";

import { useEffect, useState } from "react";

interface Preview {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

// Module-level cache so the same URL isn't re-fetched per message render.
const memo = new Map<string, Preview | null>();

// An Open Graph preview card under a chat message. Renders nothing until (and
// unless) the server returns usable metadata, so plain links stay clean.
export default function LinkPreview({ url }: { url: string }) {
  const [preview, setPreview] = useState<Preview | null>(
    memo.get(url) ?? null
  );
  const [done, setDone] = useState(memo.has(url));

  useEffect(() => {
    if (memo.has(url)) {
      setPreview(memo.get(url) ?? null);
      setDone(true);
      return;
    }
    let active = true;
    fetch(`/api/link-preview?url=${encodeURIComponent(url)}`)
      .then((r) => (r.ok ? r.json() : { preview: null }))
      .then((d) => {
        memo.set(url, d.preview ?? null);
        if (active) {
          setPreview(d.preview ?? null);
          setDone(true);
        }
      })
      .catch(() => active && setDone(true));
    return () => {
      active = false;
    };
  }, [url]);

  if (!done || !preview || (!preview.title && !preview.image)) return null;

  let host = preview.siteName;
  if (!host) {
    try {
      host = new URL(preview.url).hostname.replace(/^www\./, "");
    } catch {
      host = null;
    }
  }

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      onClick={(e) => e.stopPropagation()}
      className="mt-1.5 block overflow-hidden rounded-xl border border-white/15 bg-black/20 transition hover:bg-black/30"
    >
      {preview.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/image-proxy?url=${encodeURIComponent(preview.image)}`}
          alt=""
          className="max-h-44 w-full object-cover"
          loading="lazy"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      )}
      <div className="px-3 py-2">
        {host && (
          <div className="truncate text-[11px] uppercase tracking-wide text-white/40">
            {host}
          </div>
        )}
        {preview.title && (
          <div className="line-clamp-2 text-sm font-medium text-white/90">
            {preview.title}
          </div>
        )}
        {preview.description && (
          <div className="mt-0.5 line-clamp-2 text-xs text-white/50">
            {preview.description}
          </div>
        )}
      </div>
    </a>
  );
}
