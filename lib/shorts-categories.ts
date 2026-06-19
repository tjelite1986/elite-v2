import type { ShortCategory } from "./db";

// The 18+ sorting buckets, in display order. 'uncategorized' is the inbox every
// freshly imported clip lands in until an admin sorts it.
export const SHORT_CATEGORIES: ShortCategory[] = [
  "straight",
  "gay",
  "lesbian",
  "trans",
  "uncategorized",
];

export const CATEGORY_LABELS: Record<ShortCategory, string> = {
  straight: "Straight",
  gay: "Gay",
  lesbian: "Lesbian",
  trans: "Trans",
  uncategorized: "Uncategorized",
};

// Narrow an arbitrary string to a valid category, or null when it isn't one.
export function parseCategory(value: string | null | undefined): ShortCategory | null {
  return value && (SHORT_CATEGORIES as string[]).includes(value)
    ? (value as ShortCategory)
    : null;
}
