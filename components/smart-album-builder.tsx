"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useBackDismiss } from "@/lib/use-back-dismiss";

// Build a saved smart album by combining filters (AND). At least one filter +
// a name are required.
export default function SmartAlbumBuilder({
  tags,
  years,
  onClose,
  onCreated,
}: {
  tags: string[];
  years: number[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [minRating, setMinRating] = useState(0);
  const [favorite, setFavorite] = useState(false);
  const [video, setVideo] = useState(false);
  const [gps, setGps] = useState(false);
  const [year, setYear] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useBackDismiss(true, onClose);

  const save = async () => {
    const criteria: Record<string, unknown> = {};
    if (tag) criteria.tag = tag;
    if (minRating) criteria.minRating = minRating;
    if (favorite) criteria.favorite = true;
    if (video) criteria.type = "video";
    if (gps) criteria.gps = true;
    if (year) criteria.year = year;
    if (!name.trim() || Object.keys(criteria).length === 0) {
      setError("Give it a name and at least one filter.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/gallery/smart-albums", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), criteria }),
    });
    setBusy(false);
    if (res.ok) onCreated();
    else setError("Could not save.");
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-neutral-900 p-5 text-white">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold">New smart album</h3>
          <button onClick={onClose} aria-label="Close" className="p-1">
            <X size={20} />
          </button>
        </div>

        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (e.g. Best of 2024)"
          className="mb-4 w-full rounded-xl bg-white/10 px-3 py-2.5 text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
        />

        <div className="space-y-3 text-sm">
          <label className="flex items-center justify-between gap-3">
            <span className="text-white/60">Tag</span>
            <select
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              className="rounded-lg bg-white/10 px-2 py-1.5"
            >
              <option value="">Any</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  #{t}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-white/60">Minimum rating</span>
            <select
              value={minRating}
              onChange={(e) => setMinRating(Number(e.target.value))}
              className="rounded-lg bg-white/10 px-2 py-1.5"
            >
              <option value={0}>Any</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}+ stars
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-white/60">Year</span>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="rounded-lg bg-white/10 px-2 py-1.5"
            >
              <option value={0}>Any</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={favorite}
              onChange={(e) => setFavorite(e.target.checked)}
            />
            <span className="text-white/70">Favorites only</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={video}
              onChange={(e) => setVideo(e.target.checked)}
            />
            <span className="text-white/70">Videos only</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={gps}
              onChange={(e) => setGps(e.target.checked)}
            />
            <span className="text-white/70">Has location</span>
          </label>
        </div>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-full bg-white/10 px-4 py-2 text-sm hover:bg-white/20"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="rounded-full bg-blue-600 px-5 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
          >
            Save album
          </button>
        </div>
      </div>
    </div>
  );
}
