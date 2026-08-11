"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { splitCaption, buildCaption } from "@/lib/shorts-caption";

// Edit a clip's title / source URL / #tags. Shared by the immersive short card
// and the shorts grid. A clip's caption is "title\n\n#tags\n\nSource: <url>";
// this edits the three parts and PATCHes /api/shorts/[id]. Rendered as a fixed
// overlay so it works from a grid tile too, not just the fullscreen card.
export default function ShortsEditSheet({
  shortId,
  caption,
  aiSummary = null,
  onClose,
  onSaved,
}: {
  shortId: number;
  caption: string | null;
  /** Existing vision summary, if this clip already has one. */
  aiSummary?: string | null;
  onClose: () => void;
  onSaved: (caption: string | null) => void;
}) {
  const initial = splitCaption(caption);
  const [title, setTitle] = useState(initial.title);
  const [tags, setTags] = useState(initial.tags.join(" "));
  const [source, setSource] = useState(initial.source ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [describing, setDescribing] = useState(false);
  const [described, setDescribed] = useState<string | null>(aiSummary);

  // Both call sites (the immersive card and the grid) carry only the caption,
  // so an existing description is read on open rather than threaded through
  // two component types that do not otherwise care about it.
  useEffect(() => {
    if (aiSummary) return;
    let cancelled = false;
    void fetch(`/api/shorts/summarize?id=${shortId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.summary?.summary) setDescribed(d.summary.summary);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [shortId, aiSummary]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    // Normalize the tags field: every word becomes a #tag.
    const tagList = tags
      .split(/[\s,]+/)
      .map((t) => t.replace(/^#+/, "").trim())
      .filter(Boolean)
      .map((t) => `#${t}`);
    const src = source.trim();
    if (src && !/^https?:\/\/\S+$/i.test(src)) {
      setError("Source must be a full http(s) URL.");
      setSaving(false);
      return;
    }
    const next = buildCaption({ title, tags: tagList, source: src || null });
    try {
      const res = await fetch(`/api/shorts/${shortId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption: next }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) onSaved(d.caption ?? null);
      else setError(d.error || "Could not save.");
    } catch {
      setError("Could not save.");
    }
    setSaving(false);
  };

  // Describing costs one API call, so it is a deliberate button rather than
  // something that happens on open. The run is started server-side and the
  // queue is polled until it goes idle — bounded, so a stuck run cannot spin
  // here forever.
  const describe = async () => {
    if (describing) return;
    setDescribing(true);
    setError(null);
    try {
      const res = await fetch(`/api/shorts/summarize?id=${shortId}`, {
        method: "POST",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Could not describe this clip.");
        return;
      }
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const state = await fetch("/api/shorts/summarize")
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        if (state && !state.running) break;
      }
      const fresh = await fetch(`/api/shorts/summarize?id=${shortId}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      const text = fresh?.summary?.summary ?? null;
      if (text) setDescribed(text);
      else setError(fresh?.summary?.error || "The model could not read this clip.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setDescribing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl bg-neutral-900 p-5 pb-8 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-3 text-base font-semibold">Edit title, source &amp; tags</p>
        <label className="mb-1 block text-xs text-white/50">Title</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Clip title…"
          className="mb-3 w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
        />
        <label className="mb-1 block text-xs text-white/50">Source URL</label>
        <input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="https://…"
          inputMode="url"
          className="mb-3 w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
        />
        <label className="mb-1 block text-xs text-white/50">
          Tags (space-separated, # optional)
        </label>
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="#dance #funny"
          className="mb-4 w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
        />
        <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-white/50">
              <Sparkles size={13} />
              AI description
            </span>
            <button
              onClick={describe}
              disabled={describing}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-2.5 py-1 text-xs transition hover:bg-white/10 disabled:opacity-50"
            >
              {describing ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Sparkles size={12} />
              )}
              {describing ? "Reading…" : described ? "Redo" : "Describe"}
            </button>
          </div>
          <p className="text-sm text-white/70">
            {described ??
              (describing
                ? "Sampling frames…"
                : "Not described yet — costs one API call.")}
          </p>
        </div>

        {error && <p className="mb-2 text-sm text-rose-400">{error}</p>}
        <div className="flex gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 rounded-full bg-rose-500 py-2.5 text-sm font-semibold transition active:scale-95 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={onClose}
            className="flex-1 rounded-full bg-white/10 py-2.5 text-sm font-semibold transition active:scale-95"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
