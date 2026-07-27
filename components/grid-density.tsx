"use client";

import { useEffect, useState } from "react";

// Shared "images per row" control for the media grids (posts, shorts, gallery).
// Each surface keeps its OWN preference — the density that suits a photo library
// is not the density that suits a shorts library — so the storage key is passed
// in by the caller.
export type GridCols = 1 | 2 | 3;

export const GRID_COL_ORDER: readonly GridCols[] = [3, 2, 1];

// Full class names, never interpolated: Tailwind only ships classes it can see
// as literals in the source.
export const GRID_COL_CLASS: Record<GridCols, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
};

function parseCols(raw: string | null): GridCols | null {
  const n = Number(raw);
  return n === 1 || n === 2 || n === 3 ? n : null;
}

// The stored preference, with the setter that persists it. Read POST-MOUNT
// rather than in the useState initializer: the server has no localStorage, so
// an initializer that reads it makes SSR and hydration disagree.
export function useGridCols(
  storageKey: string,
  fallback: GridCols = 3
): [GridCols, (c: GridCols) => void] {
  const [cols, setCols] = useState<GridCols>(fallback);

  useEffect(() => {
    try {
      const saved = parseCols(localStorage.getItem(storageKey));
      if (saved) setCols(saved);
    } catch {
      /* private mode — stay on the default */
    }
  }, [storageKey]);

  const update = (c: GridCols) => {
    setCols(c);
    try {
      localStorage.setItem(storageKey, String(c));
    } catch {
      /* preference just won't persist */
    }
  };

  return [cols, update];
}

export default function GridDensity({
  cols,
  onChange,
  className = "",
}: {
  cols: GridCols;
  onChange: (c: GridCols) => void;
  className?: string;
}) {
  return (
    <div className={`flex gap-1 ${className}`}>
      {GRID_COL_ORDER.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          aria-label={`${c} per row`}
          aria-pressed={c === cols}
          className={
            c === cols
              ? "rounded-full bg-white px-3 py-1 text-xs font-semibold text-black"
              : "rounded-full bg-white/10 px-3 py-1 text-xs text-white/70 transition hover:bg-white/15"
          }
        >
          {c}
        </button>
      ))}
    </div>
  );
}
