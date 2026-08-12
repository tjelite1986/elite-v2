"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Download, Loader2, Search, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MusicLibrary } from "@/lib/music-client";

// ---------------------------------------------------------------------------
// Admin-only: hand a URL to Grabbit, which downloads the audio, tags it and
// files it into a Navidrome library. This mirrors every option Grabbit's own
// Navidrome save offers — target library, the tag set that decides the file's
// library path ([Artist]/[Album (Year)]/[Title].ext), audio format and bitrate,
// SponsorBlock, extra yt-dlp flags and a scheduled start.
//
// Deliberately absent: cutting, chapter splitting and the video container.
// Grabbit rejects all three for this destination (they produce several files at
// once, which single-file tagging can't sort), so offering them would only
// produce a 400.
// ---------------------------------------------------------------------------

const AUDIO_FORMATS = [
  { value: "best", label: "Best (source)" },
  { value: "opus", label: "opus" },
  { value: "m4a", label: "m4a" },
  { value: "mp3", label: "mp3" },
  { value: "flac", label: "flac" },
  { value: "wav", label: "wav" },
  { value: "vorbis", label: "vorbis" },
  { value: "aac", label: "aac" },
  { value: "alac", label: "alac" },
];

const BITRATES = [
  { value: "", label: "Best" },
  { value: "320", label: "320k" },
  { value: "256", label: "256k" },
  { value: "192", label: "192k" },
  { value: "160", label: "160k" },
  { value: "128", label: "128k" },
  { value: "96", label: "96k" },
];

const SPONSOR_MODES = [
  { value: "", label: "Off" },
  { value: "remove", label: "Remove segments" },
  { value: "mark", label: "Keep, mark as chapters" },
];

const RELEASE_TYPES = [
  { value: "album", label: "Album" },
  { value: "single", label: "Single" },
  { value: "ep", label: "EP" },
];

interface MetaCandidate {
  source: string;
  title: string | null;
  artists: string[];
  album: string | null;
  date: string | null;
  genres: string[];
  cover: string | null;
}

const field =
  "w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-white/30";
const labelClass = "mb-1 block text-[11px] uppercase tracking-wide text-white/40";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className={labelClass}>{label}</span>
      {children}
    </div>
  );
}

export default function MusicGrab({ library }: { library: MusicLibrary }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [target, setTarget] = useState<MusicLibrary>(library);

  // Tags — these become the file's metadata AND its path in the library.
  const [title, setTitle] = useState("");
  const [artists, setArtists] = useState("");
  const [release, setRelease] = useState("album");
  const [album, setAlbum] = useState("");
  const [date, setDate] = useState("");
  const [genres, setGenres] = useState("");

  // Encoding + extras
  const [afmt, setAfmt] = useState("opus");
  const [aq, setAq] = useState("");
  const [sponsor, setSponsor] = useState("");
  const [xargs, setXargs] = useState("");
  const [at, setAt] = useState("");
  const [advanced, setAdvanced] = useState(false);

  const [resolving, setResolving] = useState(false);
  const [candidates, setCandidates] = useState<MetaCandidate[] | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setTarget(library), [library]);

  // Read the source page for its title/uploader and any music metadata the
  // extractor found, so the tag fields start from something real.
  const resolve = useCallback(async () => {
    if (!/^https?:\/\//i.test(url.trim())) {
      setError("Enter a full http(s) URL");
      return;
    }
    setResolving(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/shorts/grab/resolve?url=${encodeURIComponent(url.trim())}`
      );
      const d = await r.json();
      if (d.ok === false) {
        setError(d.error || "Could not read that link");
        return;
      }
      // grabbit's extractor returns {artist, track, album, year, genre} when the
      // site carries music metadata, and falls back to the plain video title
      // and uploader when it doesn't.
      const music = (d.music || {}) as {
        artist?: string | null;
        track?: string | null;
        album?: string | null;
        year?: number | string | null;
        genre?: string | null;
      };
      setTitle(music.track || d.title || "");
      setArtists(music.artist || d.creator || "");
      if (music.album) setAlbum(music.album);
      if (music.year) setDate(String(music.year));
      if (music.genre) setGenres(music.genre);
      setStatus(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setResolving(false);
    }
  }, [url]);

  // iTunes + Deezer, via grabbit. Picking a candidate fills every tag field at
  // once — the point is a correctly filed track, not a hand-typed one.
  const lookupSeq = useRef(0);
  const lookup = useCallback(async () => {
    const q = [artists, title].filter(Boolean).join(" ").trim();
    if (!q) {
      setError("Fill in a title or artist first, or fetch them from the link");
      return;
    }
    const mine = ++lookupSeq.current;
    setLookingUp(true);
    setError(null);
    try {
      const r = await fetch(`/api/music/grab/meta?q=${encodeURIComponent(q)}`);
      const d = await r.json();
      if (mine !== lookupSeq.current) return;
      if (d.ok === false) {
        setError(d.error || "Lookup failed");
        setCandidates([]);
        return;
      }
      setCandidates(d.candidates || []);
    } catch (e) {
      if (mine === lookupSeq.current) setError((e as Error).message);
    } finally {
      if (mine === lookupSeq.current) setLookingUp(false);
    }
  }, [artists, title]);

  const applyCandidate = useCallback((c: MetaCandidate) => {
    if (c.title) setTitle(c.title);
    if (c.artists?.length) setArtists(c.artists.join(", "));
    if (c.album) setAlbum(c.album);
    if (c.date) setDate(c.date);
    if (c.genres?.length) setGenres(c.genres.join(", "));
    setCandidates(null);
  }, []);

  const submit = useCallback(async () => {
    if (!/^https?:\/\//i.test(url.trim())) {
      setError("Enter a full http(s) URL");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const scheduledAt = at ? new Date(at).getTime() : undefined;
      const res = await fetch("/api/music/grab", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          library: target,
          title: title.trim() || undefined,
          artists: artists.trim() || undefined,
          album: release === "single" ? undefined : album.trim() || undefined,
          release,
          date: date.trim() || undefined,
          genres: genres.trim() || undefined,
          afmt,
          aq: aq || undefined,
          sponsor: sponsor || undefined,
          xargs: xargs.trim() || undefined,
          at: Number.isFinite(scheduledAt) ? scheduledAt : undefined,
        }),
      });
      const data = await res.json();
      if (data.ok === false) {
        setError(data.error || "Download failed");
        return;
      }
      setStatus(
        scheduledAt && scheduledAt > Date.now()
          ? `Scheduled for ${new Date(scheduledAt).toLocaleString()}.`
          : "Queued — it appears after Navidrome's next scan."
      );
      setUrl("");
      setTitle("");
      setArtists("");
      setAlbum("");
      setDate("");
      setGenres("");
      setXargs("");
      setAt("");
      setCandidates(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [url, target, title, artists, album, release, date, genres, afmt, aq, sponsor, xargs, at]);

  return (
    <div className="mx-4 mt-4 rounded-xl border border-white/10 bg-white/5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm"
      >
        <Download size={16} className="text-white/50" />
        <span className="flex-1">Add music from a link</span>
        <ChevronDown
          size={16}
          className={cn("text-white/40 transition", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="space-y-3 border-t border-white/10 p-3">
          <div className="flex gap-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              className={cn(field, "min-w-0 flex-1")}
            />
            <button
              onClick={resolve}
              disabled={resolving || !url.trim()}
              title="Read the page for its title and artist"
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 px-3 text-sm text-white/80 transition hover:text-white disabled:opacity-40"
            >
              {resolving ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Sparkles size={15} />
              )}
              Fetch
            </button>
          </div>

          <Field label="Save to">
            <div className="flex rounded-lg border border-white/10 p-0.5 text-xs">
              {(["main", "kids"] as MusicLibrary[]).map((l) => (
                <button
                  key={l}
                  onClick={() => setTarget(l)}
                  className={cn(
                    "flex-1 rounded-md px-3 py-1.5 transition",
                    target === l
                      ? "bg-white text-black"
                      : "text-white/50 hover:text-white"
                  )}
                >
                  {l === "kids" ? "Kids library" : "Music library"}
                </button>
              ))}
            </div>
          </Field>

          {/* Tags decide both the file's metadata and where it lands:
              [Artist]/[Album (Year)]/[Title].ext */}
          <Field label="Song title">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={field}
            />
          </Field>

          <Field label="Artists / group (comma-separated)">
            <div className="flex gap-2">
              <input
                value={artists}
                onChange={(e) => setArtists(e.target.value)}
                placeholder="Artist 1, Artist 2"
                className={cn(field, "min-w-0 flex-1")}
              />
              <button
                onClick={lookup}
                disabled={lookingUp}
                title="Look the track up on iTunes + Deezer"
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 px-3 text-sm text-white/80 transition hover:text-white disabled:opacity-40"
              >
                {lookingUp ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Search size={15} />
                )}
                Look up
              </button>
            </div>
          </Field>

          {candidates && (
            <div className="max-h-64 overflow-y-auto rounded-lg border border-white/10">
              {candidates.length === 0 ? (
                <p className="px-3 py-3 text-xs text-white/40">No matches.</p>
              ) : (
                candidates.map((c, i) => (
                  <button
                    key={`${c.source}-${i}`}
                    onClick={() => applyCandidate(c)}
                    className="flex w-full items-center gap-3 border-b border-white/5 px-3 py-2 text-left transition last:border-0 hover:bg-white/5"
                  >
                    {/* External artwork has to go through the image proxy —
                        the app's CSP is img-src 'self'. */}
                    {c.cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/image-proxy?url=${encodeURIComponent(c.cover)}`}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded object-cover"
                      />
                    ) : (
                      <span className="h-10 w-10 shrink-0 rounded bg-white/5" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{c.title}</span>
                      <span className="block truncate text-xs text-white/40">
                        {[c.artists?.join(", "), c.album, c.date?.slice(0, 4)]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <span className="shrink-0 text-[10px] uppercase text-white/30">
                      {c.source}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}

          <Field label="Release type">
            <div className="flex rounded-lg border border-white/10 p-0.5 text-xs">
              {RELEASE_TYPES.map((r) => (
                <button
                  key={r.value}
                  onClick={() => setRelease(r.value)}
                  className={cn(
                    "flex-1 rounded-md px-3 py-1.5 transition",
                    release === r.value
                      ? "bg-white text-black"
                      : "text-white/50 hover:text-white"
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </Field>

          {/* A single is filed under its own name, so it has no album field —
              same rule grabbit applies server-side. */}
          {release !== "single" && (
            <Field label={release === "ep" ? "EP" : "Album"}>
              <input
                value={album}
                onChange={(e) => setAlbum(e.target.value)}
                className={field}
              />
            </Field>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Field label="Release date">
              <input
                value={date}
                onChange={(e) => setDate(e.target.value)}
                placeholder="YYYY or YYYY-MM-DD"
                className={field}
              />
            </Field>
            <Field label="Genres">
              <input
                value={genres}
                onChange={(e) => setGenres(e.target.value)}
                placeholder="Pop, Dance"
                className={field}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Format">
              <select
                value={afmt}
                onChange={(e) => setAfmt(e.target.value)}
                className={field}
              >
                {AUDIO_FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Bitrate">
              <select
                value={aq}
                onChange={(e) => setAq(e.target.value)}
                className={field}
              >
                {BITRATES.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <button
            onClick={() => setAdvanced((a) => !a)}
            className="flex w-full items-center gap-1.5 text-xs text-white/40 transition hover:text-white"
          >
            <ChevronDown
              size={13}
              className={cn("transition", advanced && "rotate-180")}
            />
            Advanced
          </button>

          {advanced && (
            <div className="space-y-3 rounded-lg border border-white/10 p-3">
              <Field label="SponsorBlock">
                <select
                  value={sponsor}
                  onChange={(e) => setSponsor(e.target.value)}
                  className={field}
                >
                  {SPONSOR_MODES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
              {/* Grabbit only accepts a safe subset of long yt-dlp flags and
                  rejects the rest outright, so the hint has to name one that is
                  actually on that list. */}
              <Field label="Extra yt-dlp flags (safe subset only)">
                <input
                  value={xargs}
                  onChange={(e) => setXargs(e.target.value)}
                  placeholder="--limit-rate 2M"
                  className={field}
                />
              </Field>
              <Field label="Start at (leave empty to run now)">
                <input
                  type="datetime-local"
                  value={at}
                  onChange={(e) => setAt(e.target.value)}
                  className={field}
                />
              </Field>
            </div>
          )}

          <button
            onClick={submit}
            disabled={busy || !url.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-white py-2 text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-40"
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            {at ? "Schedule download" : "Download"}
          </button>

          {error && <p className="text-xs text-rose-400">{error}</p>}
          {status && <p className="text-xs text-emerald-400">{status}</p>}
        </div>
      )}
    </div>
  );
}
