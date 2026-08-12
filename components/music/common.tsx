"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Disc3, Music4 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Album, MusicLibrary } from "@/lib/music-client";
import { coverUrl } from "@/lib/music-client";

// Small shared pieces for the /music pages: artwork with a placeholder, the
// section header, the empty/error states and the library switcher.

export function Cover({
  coverArt,
  library,
  size = 300,
  rounded = "rounded-lg",
  className,
  icon,
}: {
  coverArt: string | null;
  library: MusicLibrary;
  size?: number;
  rounded?: string;
  className?: string;
  icon?: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const url = coverUrl(coverArt, library, size);
  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-hidden bg-white/5 text-white/20",
        rounded,
        className
      )}
    >
      {url && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        icon || <Disc3 size={Math.max(18, Math.round(size / 8))} />
      )}
    </div>
  );
}

export function MusicPageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string | null;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3 px-4 pt-[calc(env(safe-area-inset-top)+1rem)] pb-3">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold">{title}</h1>
        {subtitle && (
          <p className="mt-0.5 truncate text-sm text-white/45">{subtitle}</p>
        )}
      </div>
      {right}
    </div>
  );
}

export function AlbumCard({
  album,
  library,
  width = "w-36",
}: {
  album: Album;
  library: MusicLibrary;
  width?: string;
}) {
  return (
    <Link
      href={`/music/albums/${encodeURIComponent(album.id)}?library=${library}`}
      className={cn("group block shrink-0", width)}
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
  );
}

export function Shelf({
  title,
  href,
  children,
}: {
  title: string;
  href?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-5">
      <div className="flex items-baseline justify-between px-4">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {href && (
          <Link href={href} className="text-xs text-white/40 hover:text-white">
            See all
          </Link>
        )}
      </div>
      {/* Horizontal shelves scroll on their own; the page never does. */}
      <div className="mt-2 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {children}
      </div>
    </section>
  );
}

export function LibrarySwitcher({
  library,
  basePath,
}: {
  library: MusicLibrary;
  basePath: string;
}) {
  const [libraries, setLibraries] = useState<
    { id: MusicLibrary; label: string }[]
  >([]);

  useEffect(() => {
    fetch("/api/music/libraries")
      .then((r) => r.json())
      .then((d) => setLibraries(d.libraries || []))
      .catch(() => setLibraries([]));
  }, []);

  // One library is the normal case (the kids instance is usually stopped) —
  // don't show a switcher with nothing to switch to.
  if (libraries.length < 2) return null;

  return (
    <div className="flex shrink-0 rounded-full border border-white/10 p-0.5 text-xs">
      {libraries.map((l) => (
        <Link
          key={l.id}
          href={`${basePath}?library=${l.id}`}
          className={cn(
            "rounded-full px-3 py-1 transition",
            l.id === library
              ? "bg-white text-black"
              : "text-white/50 hover:text-white"
          )}
        >
          {l.label}
        </Link>
      ))}
    </div>
  );
}

/**
 * Shown when the music backend can't answer: unconfigured, unreachable, or
 * unable to provision a Navidrome account. The link form is the documented
 * fallback for the last case.
 */
export function MusicUnavailable({
  message,
  reason,
  library,
}: {
  message: string;
  reason?: string;
  library: MusicLibrary;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const link = useCallback(async () => {
    setBusy(true);
    setLinkError(null);
    try {
      const res = await fetch("/api/music/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password, library }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error || "Link failed");
      location.reload();
    } catch (e) {
      setLinkError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [username, password, library]);

  const canLink = reason !== "not_configured";

  return (
    <div className="mx-auto max-w-md px-4 py-12 text-center">
      <Music4 size={40} className="mx-auto text-white/20" />
      <h2 className="mt-4 text-lg font-semibold">Music is not available</h2>
      <p className="mt-1 text-sm text-white/50">{message}</p>

      {canLink && (
        <div className="mt-8 rounded-xl border border-white/10 bg-white/5 p-4 text-left">
          <p className="text-sm font-medium">Link a Navidrome account</p>
          <p className="mt-1 text-xs text-white/40">
            Elite normally creates one for you. If that failed, sign in with an
            existing Navidrome user — the password is used once and not stored.
          </p>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            autoComplete="username"
            className="mt-3 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-white/30"
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            placeholder="Password"
            autoComplete="current-password"
            className="mt-2 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-white/30"
          />
          {linkError && (
            <p className="mt-2 text-xs text-rose-400">{linkError}</p>
          )}
          <button
            onClick={link}
            disabled={busy || !username || !password}
            className="mt-3 w-full rounded-lg bg-white py-2 text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-40"
          >
            {busy ? "Linking…" : "Link account"}
          </button>
        </div>
      )}
    </div>
  );
}

export function MusicSkeleton() {
  return (
    <div className="space-y-3 px-4 py-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-14 animate-pulse rounded-lg bg-white/5" />
      ))}
    </div>
  );
}
