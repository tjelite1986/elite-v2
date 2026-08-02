"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  ExternalLink,
  Loader2,
  Search,
  Tag,
  Trash2,
  Users,
  Wand2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useBackDismiss } from "@/lib/use-back-dismiss";

// Same slug rule as lib/video-performers.ts — kept in sync by hand because the
// server module pulls in better-sqlite3 and cannot be imported from a client
// component.
function performerSlug(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "unknown"
  );
}

// Metadata block on an 18+ watch page: what is known about the film, and (for
// admins) a picker to correct it. Automatic matching handles the easy cases;
// this is what makes the rest fixable by hand instead of permanently wrong.

export interface VideoMetadata {
  source: string | null;
  id: string | null;
  type: string | null;
  title: string | null;
  date: string | null;
  studio: string | null;
  synopsis: string | null;
  performers: string[];
  tags: string[];
  url: string | null;
  status: string | null;
  hasPoster: boolean;
}

interface Candidate {
  id: string;
  type: "movie" | "scene";
  title: string;
  date: string | null;
  duration: number | null;
  studio: string | null;
  posterUrl: string | null;
  performers: string[];
  score: number;
  durationDelta: number | null;
}

function runtime(seconds: number | null): string | null {
  if (!seconds) return null;
  const m = Math.round(seconds / 60);
  return `${m} min`;
}

export default function VideoMetadataPanel({
  videoId,
  fallbackTitle,
  metadata: initial,
  isAdmin,
}: {
  videoId: number;
  fallbackTitle: string;
  metadata: VideoMetadata | null;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [meta, setMeta] = useState<VideoMetadata | null>(initial);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(fallbackTitle);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMeta(initial), [initial]);

  useBackDismiss(open, () => setOpen(false));

  const search = useCallback(
    async (q: string) => {
      setSearching(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/videos/${videoId}/metadata?search=1&q=${encodeURIComponent(q)}`
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || "Lookup failed.");
          setCandidates([]);
        } else {
          setCandidates(data.candidates || []);
        }
      } catch {
        setError("Could not reach the server.");
      } finally {
        setSearching(false);
      }
    },
    [videoId]
  );

  // Open the picker with results already on screen for the obvious query.
  useEffect(() => {
    if (open && candidates.length === 0 && !searching) void search(query);
    // Intentionally only on open — retyping re-searches via the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const apply = async (c: Candidate) => {
    setApplyingId(c.id);
    setError(null);
    try {
      const res = await fetch(`/api/videos/${videoId}/metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: c.id, type: c.type }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not apply that match.");
        return;
      }
      setMeta(data.metadata);
      setOpen(false);
      router.refresh();
    } finally {
      setApplyingId(null);
    }
  };

  const clear = async () => {
    const res = await fetch(`/api/videos/${videoId}/metadata`, {
      method: "DELETE",
    });
    if (res.ok) {
      setMeta(null);
      router.refresh();
    }
  };

  const matched = Boolean(meta?.title || meta?.studio);
  // Both the uuid and the numeric id resolve on the site; the path just needs
  // the plural of the record type.
  const tpdbUrl =
    meta?.id && meta?.type
      ? `https://theporndb.net/${meta.type === "movie" ? "movies" : "scenes"}/${meta.id}`
      : null;

  return (
    <>
      <div className="mt-3 rounded-xl bg-white/5 px-3.5 py-3 text-sm">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {matched ? (
              <>
                <p className="font-medium text-white">{meta?.title}</p>
                <p className="mt-0.5 text-xs text-white/50">
                  {[meta?.studio, meta?.date?.slice(0, 4)]
                    .filter(Boolean)
                    .join(" · ")}
                  {meta?.source === "nfo" ? " · from sidecar" : ""}
                  {meta?.source === "tpdb" ? " · ThePornDB" : ""}
                </p>
              </>
            ) : (
              <p className="text-xs text-white/40">
                No metadata matched for this video.
              </p>
            )}
          </div>
          {isAdmin && (
            <div className="flex shrink-0 gap-1">
              <button
                onClick={() => setOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1 text-xs transition hover:bg-white/10"
              >
                <Wand2 size={13} />
                {matched ? "Rematch" : "Match"}
              </button>
              {matched && (
                <button
                  onClick={clear}
                  aria-label="Clear metadata"
                  className="inline-flex items-center rounded-full border border-white/15 px-2 py-1 text-xs text-white/60 transition hover:bg-white/10"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          )}
        </div>

        {meta?.synopsis && (
          <p className="mt-2 whitespace-pre-wrap text-white/70">{meta.synopsis}</p>
        )}

        {meta && meta.performers.length > 0 && (
          <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-white/60">
            <Users size={12} className="text-white/40" />
            {meta.performers.map((name, i) => (
              <span key={name}>
                <Link
                  href={`/videos18/performer/${performerSlug(name)}`}
                  className="underline-offset-2 transition hover:text-white hover:underline"
                >
                  {name}
                </Link>
                {i < meta.performers.length - 1 ? "," : ""}
              </span>
            ))}
          </p>
        )}

        {meta && meta.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Tag size={12} className="text-white/40" />
            {meta.tags.slice(0, 12).map((t) => (
              <span
                key={t}
                className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/60"
              >
                {t}
              </span>
            ))}
          </div>
        )}

        {(meta?.url || tpdbUrl) && (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {tpdbUrl && (
              <a
                href={tpdbUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-white/40 transition hover:text-white"
              >
                <ExternalLink size={12} />
                ThePornDB
              </a>
            )}
            {meta?.url && (
              <a
                href={meta.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-white/40 transition hover:text-white"
              >
                <ExternalLink size={12} />
                Studio page
              </a>
            )}
          </div>
        )}
      </div>

      {/* Manual picker */}
      {open && (
        <div
          className="fixed inset-0 z-[1200] flex items-end justify-center bg-black/70 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-neutral-900 p-4 text-white ring-1 ring-white/10 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              <h2 className="flex-1 text-base font-semibold">Match metadata</h2>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-full p-1 text-white/50 transition hover:bg-white/10 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void search(query);
              }}
              className="mb-3 flex gap-2"
            >
              <label className="relative flex min-w-0 flex-1 items-center">
                <Search size={14} className="absolute left-3 text-white/40" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search ThePornDB"
                  className="w-full rounded-full border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm outline-none focus:border-white/25"
                />
              </label>
              <button
                type="submit"
                disabled={searching}
                className="rounded-full bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-50"
              >
                {searching ? <Loader2 size={14} className="animate-spin" /> : "Search"}
              </button>
            </form>

            {error && (
              <p className="mb-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </p>
            )}

            {searching && candidates.length === 0 ? (
              <p className="py-6 text-center text-sm text-white/40">Searching…</p>
            ) : candidates.length === 0 ? (
              <p className="py-6 text-center text-sm text-white/40">
                No candidates. Try a shorter title — the database matches on the
                whole string, so a performer prefix usually has to go.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {candidates.map((c) => (
                  <li key={`${c.type}:${c.id}`}>
                    <button
                      onClick={() => apply(c)}
                      disabled={applyingId !== null}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-xl p-2 text-left transition hover:bg-white/10 disabled:opacity-50",
                        c.id === meta?.id && "bg-white/10"
                      )}
                    >
                      <span className="flex-1">
                        <span className="block text-sm font-medium">{c.title}</span>
                        <span className="block text-xs text-white/45">
                          {[
                            c.studio,
                            c.date?.slice(0, 10),
                            runtime(c.duration),
                            c.type === "scene" ? "scene" : "movie",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        {c.performers.length > 0 && (
                          <span className="block truncate text-xs text-white/35">
                            {c.performers.join(", ")}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 pt-0.5 text-xs text-white/40">
                        {applyingId === c.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : c.score >= 0.9 ? (
                          <Check size={14} className="text-emerald-400" />
                        ) : (
                          `${Math.round(c.score * 100)}%`
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
