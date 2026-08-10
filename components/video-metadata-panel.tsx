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
  UserPlus,
  Users,
  Wand2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useBackDismiss } from "@/lib/use-back-dismiss";
import { safeHttpUrl } from "@/lib/safe-url";

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

export interface SceneMarker {
  title: string;
  start: number;
  end: number | null;
}

export interface ScenePerformer {
  slug: string;
  name: string;
  gender: string | null;
  nationality: string | null;
  birthday: string | null;
  rating: number | null;
  // The stored filename, used as a cache-buster: replacing a portrait keeps
  // the URL but changes the key.
  imageKey: string | null;
}

interface CastEntry {
  slug: string;
  name: string;
}

// The identifier shapes lib/tpdb.ts accepts — a uuid, a numeric id, a
// "performers/1234" reference or a theporndb.net link. Kept in sync by hand:
// that module is server code and cannot be imported here.
function looksLikeTpdbRef(input: string): boolean {
  const raw = input.trim();
  if (!raw) return false;
  if (/^https?:\/\/([a-z0-9-]+\.)*theporndb\.net\//i.test(raw)) return true;
  if (/^(scenes?|movies?|performers?)\/.+$/i.test(raw)) return true;
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw) ||
    /^\d{1,12}$/.test(raw)
  );
}

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
  markers: SceneMarker[];
  rating: number | null;
}

interface Candidate {
  id: string;
  source: "tpdb" | "tmdb";
  type: string;
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

function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Age the performer was on the day the scene was shot — what the source page
// shows as "24 y/o in this scene".
function ageInScene(birthday: string | null, sceneDate: string | null): number | null {
  if (!birthday || !sceneDate) return null;
  const born = new Date(birthday);
  const shot = new Date(sceneDate);
  if (Number.isNaN(born.getTime()) || Number.isNaN(shot.getTime())) return null;
  let years = shot.getFullYear() - born.getFullYear();
  const before =
    shot.getMonth() < born.getMonth() ||
    (shot.getMonth() === born.getMonth() && shot.getDate() < born.getDate());
  if (before) years--;
  return years > 0 && years < 120 ? years : null;
}

export default function VideoMetadataPanel({
  videoId,
  fallbackTitle,
  metadata: initial,
  performers: cast = [],
  isAdmin,
  channel = "adults",
  onSeek,
}: {
  videoId: number;
  fallbackTitle: string;
  metadata: VideoMetadata | null;
  performers?: ScenePerformer[];
  isAdmin: boolean;
  // The 18+ shelf has performer profiles and a cast editor; the main channel
  // credits actors, who have no page here.
  channel?: "main" | "adults";
  onSeek?: (seconds: number) => void;
}) {
  const adults = channel === "adults";
  const router = useRouter();
  const [meta, setMeta] = useState<VideoMetadata | null>(initial);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(fallbackTitle);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Cast editor: attach performers to this film by hand, including ones no
  // sidecar or database knows about.
  const [castOpen, setCastOpen] = useState(false);
  const [castDraft, setCastDraft] = useState<CastEntry[]>([]);
  const [known, setKnown] = useState<CastEntry[]>([]);
  const [castQuery, setCastQuery] = useState("");
  const [castBusy, setCastBusy] = useState(false);
  const [castError, setCastError] = useState<string | null>(null);
  // Closing the sheet dismisses a history entry, and that navigation lands on
  // top of router.refresh() — so the saved cast is rendered from the response
  // rather than waited for from the server.
  const [castList, setCastList] = useState<ScenePerformer[]>(cast);

  useEffect(() => setMeta(initial), [initial]);
  useEffect(() => setCastList(cast), [cast]);

  useBackDismiss(open, () => setOpen(false));
  useBackDismiss(castOpen, () => setCastOpen(false));

  const openCast = async () => {
    setCastDraft(castList.map((c) => ({ slug: c.slug, name: c.name })));
    setCastQuery("");
    setCastError(null);
    setCastOpen(true);
    try {
      const res = await fetch("/api/videos/performers");
      if (res.ok) {
        const data = await res.json();
        setKnown(
          (data.performers || []).map((p: { slug: string; name: string }) => ({
            slug: p.slug,
            name: p.name,
          }))
        );
      }
    } catch {
      /* the picker still works for names already attached */
    }
  };

  const addToCast = (entry: CastEntry) => {
    setCastDraft((list) =>
      list.some((c) => c.slug === entry.slug) ? list : [...list, entry]
    );
    setCastQuery("");
  };

  // A name nobody has heard of becomes a profile of its own, which the picker
  // then treats like any other. An identifier instead of a name imports the
  // whole profile from ThePornDB — portrait, biography and photos included.
  const createAndAdd = async () => {
    const typed = castQuery.trim();
    if (!typed) return;
    const byId = looksLikeTpdbRef(typed);
    setCastBusy(true);
    setCastError(null);
    try {
      const res = await fetch("/api/videos/performers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(byId ? { tpdbId: typed } : { name: typed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCastError(data.error || "Could not create that performer.");
        return;
      }
      const entry = {
        slug: data.slug as string,
        name: data.performer?.name || typed,
      };
      setKnown((list) => [...list, entry]);
      addToCast(entry);
    } finally {
      setCastBusy(false);
    }
  };

  const saveCast = async () => {
    setCastBusy(true);
    setCastError(null);
    try {
      const res = await fetch(`/api/videos/${videoId}/performers`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slugs: castDraft.map((c) => c.slug) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCastError(data.error || "Could not save the cast.");
        return;
      }
      setCastList(
        (data.performers || []).map(
          (p: {
            slug: string;
            name: string;
            gender: string | null;
            nationality: string | null;
            birthday: string | null;
            rating: number | null;
            image_key: string | null;
          }) => ({
            slug: p.slug,
            name: p.name,
            gender: p.gender,
            nationality: p.nationality,
            birthday: p.birthday,
            rating: p.rating,
            imageKey: p.image_key,
          })
        )
      );
      setCastOpen(false);
      router.refresh();
    } finally {
      setCastBusy(false);
    }
  };

  const castMatches = known
    .filter((p) => !castDraft.some((c) => c.slug === p.slug))
    .filter((p) =>
      castQuery.trim()
        ? p.name.toLowerCase().includes(castQuery.trim().toLowerCase())
        : true
    )
    .slice(0, 40);
  const exactKnown = known.some(
    (p) => p.name.toLowerCase() === castQuery.trim().toLowerCase()
  );

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
        body: JSON.stringify({ id: c.id, type: c.type, source: c.source }),
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
  // <sourceid> comes from a sidecar that anyone dropping a release folder
  // controls, so it is never trusted as an href unmodified.
  const studioUrl = safeHttpUrl(meta?.url);
  // Both the uuid and the numeric id resolve on the site; the path just needs
  // the plural of the record type. TheMovieDB addresses an episode through its
  // series, which is why that id carries the season and episode with it.
  const recordUrl = (() => {
    if (!meta?.id || !meta?.type) return null;
    if (meta.source === "tmdb") {
      if (meta.type === "tv") {
        const [showId, season, episode] = meta.id.split(":");
        return season !== undefined && episode !== undefined
          ? `https://www.themoviedb.org/tv/${showId}/season/${season}/episode/${episode}`
          : `https://www.themoviedb.org/tv/${showId}`;
      }
      return `https://www.themoviedb.org/movie/${meta.id}`;
    }
    if (meta.source === "nfo" || meta.source === "tpdb") {
      return `https://theporndb.net/${meta.type === "movie" ? "movies" : "scenes"}/${meta.id}`;
    }
    return null;
  })();
  const recordName = meta?.source === "tmdb" ? "TheMovieDB" : "ThePornDB";

  return (
    <>
      <div className="mt-3 rounded-xl bg-white/5 px-3.5 py-3 text-sm">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {matched ? (
              <>
                <p className="font-medium text-white">{meta?.title}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-white/50">
                  {meta?.rating != null && (
                    <span className="text-amber-300">
                      {"★".repeat(Math.round(meta.rating))}
                      <span className="ml-1 text-white/45">
                        {meta.rating.toFixed(1)}
                      </span>
                    </span>
                  )}
                  <span>
                  {[meta?.studio, meta?.date?.slice(0, 10)]
                    .filter(Boolean)
                    .join(" · ")}
                  {meta?.source === "nfo" ? " · from sidecar" : ""}
                  {meta?.source === "tpdb" ? " · ThePornDB" : ""}
                  {meta?.source === "tmdb" ? " · TheMovieDB" : ""}
                  </span>
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
              {adults && (
              <button
                onClick={openCast}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1 text-xs transition hover:bg-white/10"
              >
                <Users size={13} />
                Cast
              </button>
              )}
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

        {/* Cast cards: portrait, how old they were in this scene, and the name
            linking on to the full profile. */}
        {castList.length > 0 ? (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {castList.map((c) => {
              const years = ageInScene(c.birthday, meta?.date ?? null);
              return (
                <Link
                  key={c.slug}
                  href={`/videos18/performer/${c.slug}`}
                  className="group w-28 shrink-0 overflow-hidden rounded-xl bg-white/5 transition hover:bg-white/10"
                >
                  <span className="relative block aspect-[3/4] w-full overflow-hidden bg-white/5">
                    {c.imageKey ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/videos/performers/${c.slug}/image?v=${encodeURIComponent(c.imageKey)}`}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <span className="grid h-full w-full place-items-center text-white/20">
                        <Users size={20} />
                      </span>
                    )}
                    {c.rating !== null && (
                      <span className="absolute right-1 top-1 rounded bg-black/70 px-1 py-0.5 text-[10px] font-semibold text-amber-300">
                        {c.rating.toFixed(1)}
                      </span>
                    )}
                    {years !== null && (
                      <span className="absolute inset-x-0 bottom-0 bg-black/70 px-1.5 py-0.5 text-[10px] text-white/85">
                        {years} y/o in this scene
                      </span>
                    )}
                  </span>
                  <span className="block truncate px-2 py-1.5 text-xs font-medium">
                    {c.name}
                  </span>
                </Link>
              );
            })}
          </div>
        ) : meta && meta.performers.length > 0 ? (
          <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-white/60">
            <Users size={12} className="text-white/40" />
            {meta.performers.map((name, i) => (
              <span key={name}>
                {adults ? (
                  <Link
                    href={`/videos18/performer/${performerSlug(name)}`}
                    className="underline-offset-2 transition hover:text-white hover:underline"
                  >
                    {name}
                  </Link>
                ) : (
                  name
                )}
                {i < meta.performers.length - 1 ? "," : ""}
              </span>
            ))}
          </p>
        ) : null}

        {/* Chapters — tap one to jump the player there. */}
        {meta && meta.markers.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {meta.markers.map((m) => (
              <button
                key={`${m.title}-${m.start}`}
                onClick={() => onSeek?.(m.start)}
                className="flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-2 py-1 text-xs transition hover:bg-white/15"
              >
                <span className="font-medium">{m.title}</span>
                <span className="tabular-nums text-white/45">
                  {clock(m.start)}
                  {m.end ? ` – ${clock(m.end)}` : ""}
                </span>
              </button>
            ))}
          </div>
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

        {(studioUrl || recordUrl) && (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {recordUrl && (
              <a
                href={recordUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-white/40 transition hover:text-white"
              >
                <ExternalLink size={12} />
                {recordName}
              </a>
            )}
            {studioUrl && (
              <a
                href={studioUrl}
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

      {/* Cast editor */}
      {castOpen && (
        <div
          className="fixed inset-0 z-[1200] flex items-end justify-center bg-black/70 sm:items-center"
          onClick={() => setCastOpen(false)}
        >
          <div
            className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-neutral-900 p-4 text-white ring-1 ring-white/10 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              <h2 className="flex-1 text-base font-semibold">Cast</h2>
              <button
                onClick={() => setCastOpen(false)}
                aria-label="Close"
                className="rounded-full p-1 text-white/50 transition hover:bg-white/10 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            {castError && (
              <p className="mb-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {castError}
              </p>
            )}

            {castDraft.length > 0 ? (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {castDraft.map((c) => (
                  <span
                    key={c.slug}
                    className="inline-flex items-center gap-1.5 rounded-full bg-white/10 py-1 pl-3 pr-1.5 text-xs"
                  >
                    {c.name}
                    <button
                      onClick={() =>
                        setCastDraft((list) =>
                          list.filter((x) => x.slug !== c.slug)
                        )
                      }
                      aria-label={`Remove ${c.name}`}
                      className="rounded-full p-0.5 text-white/50 transition hover:bg-white/15 hover:text-white"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="mb-3 text-xs text-white/40">
                Nobody is credited on this video yet.
              </p>
            )}

            <label className="mb-3 flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-2">
              <Search size={14} className="text-white/40" />
              <input
                value={castQuery}
                onChange={(e) => setCastQuery(e.target.value)}
                placeholder="Search or type a new name"
                className="w-full bg-transparent text-sm outline-none placeholder:text-white/30"
              />
            </label>

            {castQuery.trim() && !exactKnown && (
              <button
                onClick={createAndAdd}
                disabled={castBusy}
                className="mb-2 inline-flex w-full items-center gap-2 rounded-xl border border-dashed border-white/20 px-3 py-2 text-left text-sm transition hover:bg-white/10 disabled:opacity-50"
              >
                {castBusy ? (
                  <Loader2 size={14} className="animate-spin text-white/50" />
                ) : (
                  <UserPlus size={14} className="text-white/50" />
                )}
                {looksLikeTpdbRef(castQuery)
                  ? `Import ${castQuery.trim()} from ThePornDB`
                  : `Create “${castQuery.trim()}”`}
              </button>
            )}

            <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
              {castMatches.map((p) => (
                <li key={p.slug}>
                  <button
                    onClick={() => addToCast(p)}
                    className="w-full rounded-lg px-3 py-2 text-left text-sm transition hover:bg-white/10"
                  >
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setCastOpen(false)}
                className="rounded-full border border-white/15 px-4 py-2 text-sm transition hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={saveCast}
                disabled={castBusy}
                className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-50"
              >
                {castBusy && <Loader2 size={14} className="animate-spin" />}
                Save cast
              </button>
            </div>
          </div>
        </div>
      )}

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
                  placeholder={
                    adults
                      ? "Title, id, or theporndb.net link"
                      : "Title, or a themoviedb.org link"
                  }
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
                {!adults
                  ? "Nothing found. Try the title on its own — a release name's resolution, codec and group tags confuse the search. A themoviedb.org link, or the id from one, skips the search entirely."
                  : looksLikeTpdbRef(query)
                    ? "No record with that id. Check whether it is a scene or a movie — a bare id is tried as both."
                    : "No candidates. Try a shorter title — the database matches on the whole string, so a performer prefix usually has to go. Pasting a scene or movie id, or its theporndb.net link, skips the search entirely."}
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
                            c.type === "tv" ? "series" : c.type,
                            c.source === "tmdb" ? "TheMovieDB" : null,
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
