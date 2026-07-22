"use client";

import { useState } from "react";
import { splitCaption, buildCaption } from "@/lib/shorts-caption";

// Edit a clip's title / source URL / #tags. Shared by the immersive short card
// and the shorts grid. A clip's caption is "title\n\n#tags\n\nSource: <url>";
// this edits the three parts and PATCHes /api/shorts/[id]. Rendered as a fixed
// overlay so it works from a grid tile too, not just the fullscreen card.
export default function ShortsEditSheet({
  shortId,
  caption,
  onClose,
  onSaved,
}: {
  shortId: number;
  caption: string | null;
  onClose: () => void;
  onSaved: (caption: string | null) => void;
}) {
  const initial = splitCaption(caption);
  const [title, setTitle] = useState(initial.title);
  const [tags, setTags] = useState(initial.tags.join(" "));
  const [source, setSource] = useState(initial.source ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
