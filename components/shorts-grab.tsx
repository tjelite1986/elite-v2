"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  Search,
  Download,
  CheckCircle2,
  Globe,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Channel = "main" | "18plus";
type ImportedMap = { main: string | null; "18plus": string | null };
type Site = { domain: string; profiles: boolean | "limited" };

/**
 * One row in the list, whatever produced it: a profile listing, or one of the
 * links pasted into the box. Everything the row shows comes from grabbit's own
 * resolve/profile payload, so the two lists read the same.
 */
type GrabItem = {
  /** Profile listings key by job id; pasted links key by their URL. */
  id: string;
  /** The link to download. Profile items carry grabbit's sourceUrl. */
  url: string | null;
  title: string | null;
  creator: string | null;
  description: string | null;
  tags: string[];
  thumbnail: string | null;
  duration: number | null;
  filename: string | null;
  /** Already fetched once per grabbit's own registry — the cross-tool dedupe. */
  downloaded: boolean;
  /** Already in this app's library, per channel. */
  imported?: ImportedMap;
  tooLongForShorts?: boolean;
};

/** Fields a person may correct before the clip is saved. */
type Edit = { title?: string; creator?: string; description?: string; tags?: string };

// The preview thumbnails come from the site being grabbed, and the app's CSP
// is img-src 'self' — a remote URL is blocked outright, which is why the
// preview stayed empty. Same proxy the link previews and store imports use.
function proxied(url: string): string {
  return `/api/image-proxy?url=${encodeURIComponent(url)}`;
}

// A response is not always JSON. A proxy or CDN error page, or a login
// redirect, arrives as HTML, and res.json() then throws "Unexpected token '<'"
// — an error that says nothing about what actually went wrong. Read the body
// once and report the status instead.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {
      ok: false,
      error: `The server answered ${res.status} without JSON — the grabber may be down.`,
    };
  }
}

/** "1:04", the way the duration reads on a clip. */
function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function itemFrom(raw: any, fallbackUrl?: string): GrabItem {
  return {
    id: String(raw.id ?? fallbackUrl ?? raw.sourceUrl ?? ""),
    url: raw.sourceUrl || fallbackUrl || null,
    title: raw.title ?? null,
    creator: raw.creator ?? null,
    description: raw.description ?? null,
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    thumbnail: raw.thumbnail ?? null,
    duration: typeof raw.duration === "number" ? raw.duration : null,
    filename: raw.filename ?? null,
    downloaded: !!raw.downloaded,
    imported: raw.imported,
    tooLongForShorts: !!raw.tooLongForShorts,
  };
}

export default function ShortsGrab() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [ytdlpCount, setYtdlpCount] = useState(0);

  // One list, two origins: a resolved profile (downloadable as a batch by
  // grabbit itself) or the links that were pasted in.
  const [items, setItems] = useState<GrabItem[]>([]);
  const [profileUrl, setProfileUrl] = useState<string | null>(null);
  const [profileMeta, setProfileMeta] = useState<{ creator: string; count: number } | null>(null);

  const [channel, setChannel] = useState<Channel>("main");
  const [creator, setCreator] = useState("");
  const [web, setWeb] = useState(false);
  const [quality, setQuality] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [editing, setEditing] = useState<string | null>(null);

  const [progress, setProgress] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    fetch("/api/shorts/grab/sites")
      .then((r) => readJson(r))
      .then((d) => {
        setSites(d.sites || []);
        if (typeof d.ytdlp === "number") setYtdlpCount(d.ytdlp);
      })
      .catch(() => {});
    return () => esRef.current?.close();
  }, []);

  const reset = () => {
    setItems([]);
    setProfileUrl(null);
    setProfileMeta(null);
    setEdits({});
    setEditing(null);
    setError(null);
    setProgress(null);
    setDone(null);
    setStatus({});
    setRunning(false);
    cancelRef.current = false;
    esRef.current?.close();
  };

  /** Anything already here, in this channel or in grabbit, starts unticked. */
  const freshOnly = (list: GrabItem[], ch: Channel) =>
    new Set(list.filter((i) => !i.downloaded && !i.imported?.[ch]).map((i) => i.id));

  const fetchInfo = async () => {
    // The box takes a whole list: one link per line, or several on one line.
    const urls = Array.from(
      new Set(
        url
          .split(/[\s,]+/)
          .map((u) => u.trim())
          .filter((u) => /^https?:\/\//i.test(u))
      )
    );
    if (!urls.length) {
      setError("Paste at least one http(s) link.");
      return;
    }
    reset();
    setBusy(true);
    try {
      // A single link may be a whole profile; a pasted list never is — it is
      // taken at face value, one clip per line.
      if (urls.length === 1) {
        const pr = await fetch(`/api/shorts/grab/profile?url=${encodeURIComponent(urls[0])}`);
        const pd = await readJson(pr);
        if (pd.ok && pd.isProfile) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const list: GrabItem[] = (pd.items || []).map((i: any) => itemFrom(i));
          setItems(list);
          setProfileUrl(urls[0]);
          setProfileMeta({ creator: pd.creator || "", count: pd.count ?? list.length });
          setCreator(pd.creator || "");
          setSelected(freshOnly(list, channel));
          return;
        }
      }

      // Resolve each pasted link. Sequential on purpose: every resolve runs an
      // extractor (often yt-dlp) on the grabber, and a burst of them from one
      // paste is how you get rate-limited by the site.
      const resolved: GrabItem[] = [];
      const failed: string[] = [];
      for (const [i, u] of urls.entries()) {
        setProgress(urls.length > 1 ? `Reading link ${i + 1}/${urls.length}…` : "Reading link…");
        const r = await fetch(`/api/shorts/grab/resolve?url=${encodeURIComponent(u)}`);
        const d = await readJson(r);
        if (d.ok) resolved.push(itemFrom(d, u));
        else failed.push(u);
      }
      setProgress(null);
      if (!resolved.length) throw new Error("Could not resolve any of those links.");
      setItems(resolved);
      setSelected(freshOnly(resolved, channel));
      if (resolved.length === 1) setCreator(resolved[0].creator || "");
      if (failed.length) {
        setError(`${failed.length} link(s) could not be read: ${failed.slice(0, 3).join(", ")}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  // Run the elite-v2 importer for a channel so grabbed clips appear right away.
  const runImport = useCallback(
    async (ch: Channel) => {
      try {
        const r = await fetch("/api/shorts/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel: ch }),
        });
        const d = await readJson(r);
        router.refresh();
        return typeof d.imported === "number" ? d.imported : null;
      } catch {
        return null;
      }
    },
    [router]
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allSelected = items.length > 0 && selected.size === items.length;
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)));

  const editOf = (id: string): Edit => edits[id] ?? {};
  const setEdit = (id: string, patch: Edit) =>
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  const isEdited = (id: string) =>
    Object.values(edits[id] ?? {}).some((v) => v !== undefined);

  /**
   * Download the selection one clip at a time, carrying each row's edits. The
   * per-item route is what makes the edits possible at all — grabbit's batch
   * endpoint takes one creator for the whole run and nothing else.
   */
  const downloadOneByOne = async (ids: string[]) => {
    setRunning(true);
    cancelRef.current = false;
    setDone(null);
    setError(null);
    setStatus({});
    let saved = 0;
    let skipped = 0;
    let failed = 0;
    for (const [i, id] of ids.entries()) {
      if (cancelRef.current) break;
      const item = items.find((x) => x.id === id);
      if (!item?.url) {
        failed++;
        setStatus((s) => ({ ...s, [id]: "failed" }));
        continue;
      }
      setProgress(`${i + 1}/${ids.length} — ${item.title || item.url}`);
      setStatus((s) => ({ ...s, [id]: "downloading" }));
      const e = editOf(id);
      const qs = new URLSearchParams({ url: item.url, channel });
      const who = e.creator ?? (ids.length === 1 ? creator : "");
      if (who?.trim()) qs.set("creator", who.trim());
      // Only edited fields are sent: an untouched clip keeps the metadata the
      // extractor found, which is richer than what the preview shows.
      if (e.title !== undefined) qs.set("title", e.title);
      if (e.description !== undefined) qs.set("description", e.description);
      if (e.tags !== undefined) qs.set("tags", e.tags);
      if (web) qs.set("web", "1");
      if (quality) qs.set("quality", quality);
      try {
        const r = await fetch(`/api/shorts/grab/download?${qs.toString()}`);
        const d = await readJson(r);
        if (!d.ok) {
          failed++;
          setStatus((s) => ({ ...s, [id]: d.error?.slice(0, 40) || "failed" }));
        } else if (d.saved === false) {
          skipped++;
          setStatus((s) => ({ ...s, [id]: "already saved" }));
        } else {
          saved++;
          setStatus((s) => ({ ...s, [id]: "saved" }));
          // grabbit registered the save in its own downloaded registry, so the
          // row is now "known" to both tools — show that straight away.
          setItems((prev) => prev.map((x) => (x.id === id ? { ...x, downloaded: true } : x)));
        }
      } catch {
        failed++;
        setStatus((s) => ({ ...s, [id]: "failed" }));
      }
    }
    setProgress("Importing…");
    const n = await runImport(channel);
    setRunning(false);
    setProgress(null);
    setDone(
      `Done: ${saved} saved, ${skipped} skipped, ${failed} failed${n != null ? ` · imported ${n}` : ""}.`
    );
  };

  /** grabbit's own batch run: one request, server-side loop, SSE progress. */
  const downloadProfileBatch = (ids: string[]) => {
    if (!profileUrl) return;
    setRunning(true);
    setDone(null);
    setError(null);
    setStatus({});
    setProgress("Starting…");

    const qs = new URLSearchParams({ url: profileUrl, channel, ids: ids.join(",") });
    if (creator.trim()) qs.set("creator", creator.trim());
    if (web) qs.set("web", "1");
    if (quality) qs.set("quality", quality);

    const es = new EventSource(`/api/shorts/grab/download-all?${qs.toString()}`);
    esRef.current = es;
    es.onmessage = async (ev) => {
      const d = JSON.parse(ev.data);
      if (d.type === "start") setProgress(`Downloading ${d.total} clip(s)…`);
      else if (d.type === "progress") {
        setStatus((s) => ({ ...s, [d.id]: d.status }));
        setProgress(`${d.index}/${d.total} processed…`);
        if (d.status === "saved") {
          setItems((prev) => prev.map((x) => (x.id === d.id ? { ...x, downloaded: true } : x)));
        }
      } else if (d.type === "done") {
        es.close();
        setProgress("Importing…");
        const n = await runImport(channel);
        setRunning(false);
        setProgress(null);
        setDone(
          `Done: ${d.saved} saved, ${d.skipped} skipped, ${d.failed} failed${n != null ? ` · imported ${n}` : ""}.`
        );
      } else if (d.type === "error") {
        es.close();
        setRunning(false);
        setProgress(null);
        setError(d.error || "Download failed");
      }
    };
    es.onerror = () => {
      es.close();
      setRunning(false);
      setProgress(null);
      setError("Connection lost.");
    };
  };

  const grabSelected = () => {
    const ids = items.filter((i) => selected.has(i.id)).map((i) => i.id);
    if (!ids.length) return;
    // The batch endpoint is faster for a big profile, but it cannot carry
    // per-clip metadata — so an edited selection goes one by one.
    if (profileUrl && !ids.some(isEdited)) downloadProfileBatch(ids);
    else void downloadOneByOne(ids);
  };

  const chBtn = (c: Channel, label: string) => (
    <button
      type="button"
      onClick={() => {
        setChannel(c);
        // The "already here" marks are per channel, so the default selection
        // follows the switch.
        if (items.length) setSelected(freshOnly(items, c));
      }}
      className={cn(
        "rounded-full px-4 py-1.5 text-sm font-medium transition",
        channel === c ? "bg-white text-black" : "text-white/70 hover:text-white"
      )}
    >
      {label}
    </button>
  );

  const field = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    placeholder?: string,
    textarea = false
  ) => (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wide text-white/40">{label}</span>
      {textarea ? (
        <textarea
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full resize-y rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/30"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/30"
        />
      )}
    </label>
  );

  return (
    <div className="space-y-5">
      {/* Links in: one per line, or a single profile URL. */}
      <div className="space-y-2">
        <textarea
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter makes another line — a list of links is
            // the normal case here.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              fetchInfo();
            }
          }}
          rows={3}
          placeholder={"Paste one or more links — one per line…"}
          className="w-full resize-y rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none focus:border-white/30"
        />
        <div className="flex items-center gap-3">
          <button
            onClick={fetchInfo}
            disabled={busy || !url.trim()}
            className="flex items-center gap-2 rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold transition active:scale-95 hover:bg-white/15 disabled:opacity-50"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            Fetch
          </button>
          <span className="text-xs text-white/40">
            A profile link lists the whole profile; several links are read one by one.
          </span>
        </div>
      </div>

      {/* Where it lands, decided up front: the channel is the first thing you
          want to be sure of, and hiding it until a link resolved made it look
          like the tool only fed Shorts. */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-white/50">Save to</span>
        <div className="flex items-center gap-0.5 rounded-full bg-black/40 p-1 ring-1 ring-white/10">
          {chBtn("main", "Shorts")}
          {chBtn("18plus", "Shorts 18+")}
        </div>
      </div>

      {error && <p className="text-sm text-rose-400">{error}</p>}

      {items.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-white/60">
              {profileMeta
                ? `@${profileMeta.creator} — ${profileMeta.count} clips · ${selected.size} selected`
                : `${items.length} link(s) · ${selected.size} selected`}
            </p>
            <button onClick={toggleAll} className="text-sm text-white/70 hover:text-white">
              {allSelected ? "Select none" : "Select all"}
            </button>
          </div>

          {/* Shared controls: profile name for the whole run, format, quality. */}
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={creator}
              onChange={(e) => setCreator(e.target.value)}
              placeholder="Profile name"
              className="min-w-[160px] flex-1 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm outline-none focus:border-white/30"
            />
            <label
              title="Save a web-optimized .web.mp4 — ready instantly, skips the transcoder"
              className="flex cursor-pointer select-none items-center gap-2 text-sm text-white/70"
            >
              <input
                type="checkbox"
                checked={web}
                onChange={(e) => setWeb(e.target.checked)}
                className="h-4 w-4 accent-rose-500"
              />
              Web format
            </label>
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/30"
            >
              <option value="">Best quality</option>
              <option value="1080">1080p</option>
              <option value="720">720p</option>
              <option value="480">480p</option>
            </select>
          </div>

          <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
            {items.map((it) => {
              const st = status[it.id];
              const e = editOf(it.id);
              const open = editing === it.id;
              const here = it.imported?.[channel];
              return (
                <div
                  key={it.id}
                  className={cn(
                    "rounded-xl border border-white/5 transition",
                    selected.has(it.id) ? "bg-white/5" : "opacity-60"
                  )}
                >
                  <div className="flex items-start gap-3 p-2.5">
                    <input
                      type="checkbox"
                      checked={selected.has(it.id)}
                      onChange={() => toggle(it.id)}
                      className="mt-6 h-4 w-4 flex-none accent-rose-500"
                    />
                    <div className="relative flex-none">
                      {it.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={proxied(it.thumbnail)}
                          alt=""
                          loading="lazy"
                          className="h-16 w-28 rounded-lg bg-white/10 object-cover"
                        />
                      ) : (
                        <div className="h-16 w-28 rounded-lg bg-white/10" />
                      )}
                      {it.duration != null && (
                        <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 text-[10px] font-medium tabular-nums text-white">
                          {clock(it.duration)}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-medium">
                        {e.title ?? it.title ?? it.filename ?? it.url}
                      </p>
                      <p className="truncate text-xs text-white/50">
                        @{e.creator ?? it.creator ?? "unknown"}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                        {here && (
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-300">
                            In the library
                          </span>
                        )}
                        {it.downloaded && (
                          <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-sky-300">
                            Grabbed before
                          </span>
                        )}
                        {it.tooLongForShorts && (
                          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-300">
                            Too long for Shorts
                          </span>
                        )}
                        {isEdited(it.id) && (
                          <span className="rounded-full bg-white/10 px-2 py-0.5 text-white/60">
                            Edited
                          </span>
                        )}
                        {st && (
                          <span
                            className={cn(
                              st === "saved"
                                ? "text-emerald-400"
                                : st === "already saved" || st === "skipped"
                                  ? "text-amber-400"
                                  : st === "downloading"
                                    ? "text-white/50"
                                    : "text-rose-400"
                            )}
                          >
                            {st}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => setEditing(open ? null : it.id)}
                      aria-label={open ? "Close editor" : "Edit details"}
                      className="mt-1 flex-none rounded-full p-2 text-white/50 transition hover:bg-white/10 hover:text-white"
                    >
                      {open ? <X size={16} /> : <Pencil size={16} />}
                    </button>
                  </div>

                  {open && (
                    <div className="space-y-3 border-t border-white/5 p-3">
                      {field("Title", e.title ?? it.title ?? "", (v) => setEdit(it.id, { title: v }))}
                      {field(
                        "User / profile",
                        e.creator ?? it.creator ?? "",
                        (v) => setEdit(it.id, { creator: v }),
                        "Saved under this profile"
                      )}
                      {field(
                        "Description",
                        e.description ?? it.description ?? "",
                        (v) => setEdit(it.id, { description: v }),
                        "Caption text",
                        true
                      )}
                      {field(
                        "Tags",
                        e.tags ?? it.tags.join(" "),
                        (v) => setEdit(it.id, { tags: v }),
                        "#tag #another"
                      )}
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setEditing(null)}
                          className="flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-1.5 text-sm font-medium transition hover:bg-white/15"
                        >
                          <Check size={14} /> Done
                        </button>
                        {isEdited(it.id) && (
                          <button
                            onClick={() =>
                              setEdits((prev) => {
                                const next = { ...prev };
                                delete next[it.id];
                                return next;
                              })
                            }
                            className="text-sm text-white/50 transition hover:text-white"
                          >
                            Reset
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={grabSelected}
              disabled={running || !selected.size}
              className="flex w-fit items-center gap-2 rounded-full bg-rose-500 px-5 py-2.5 text-sm font-semibold transition active:scale-95 disabled:opacity-50"
            >
              {running ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              Download selected ({selected.size})
            </button>
            {running && (
              <button
                onClick={() => {
                  cancelRef.current = true;
                  esRef.current?.close();
                }}
                className="rounded-full bg-white/10 px-4 py-2 text-sm transition hover:bg-white/15"
              >
                Stop
              </button>
            )}
          </div>
        </div>
      )}

      {progress && (
        <p className="flex items-center gap-2 text-sm text-white/70">
          <Loader2 size={14} className="animate-spin" /> {progress}
        </p>
      )}
      {done && (
        <p className="flex items-center gap-2 text-sm text-emerald-400">
          <CheckCircle2 size={15} /> {done}
        </p>
      )}

      {/* Supported sites */}
      {sites.length > 0 && (
        <div className="border-t border-white/10 pt-4">
          <p className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wide text-white/40">
            <Globe size={12} /> Supported sites
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            {sites.map((s) => (
              <span
                key={s.domain}
                className="flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 ring-1 ring-white/10"
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    s.profiles === "limited" ? "bg-amber-400" : "bg-emerald-400"
                  )}
                />
                {s.domain}
              </span>
            ))}
            <span className="flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 ring-1 ring-white/10">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              + yt-dlp{" "}
              {ytdlpCount ? `(~${ytdlpCount} sites, incl. playlists/channels)` : "(many sites)"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
