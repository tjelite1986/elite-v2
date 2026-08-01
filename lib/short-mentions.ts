import { db } from "./db";

// @mentions inside a clip's caption make that clip surface on the mentioned
// person's profile too (in addition to the profile it was imported under). So a
// clip on "thebikinireport" whose caption starts "@sarahharlow …" also shows on
// Sarah's profile — including via her aliases, since callers pass the whole
// handle group (primary + aliases).

// Local slug rule — same as directory.handleOf / profile-links.norm. Kept local
// so this module doesn't import directory.ts (which imports back here-adjacent
// modules); avoids a cycle.
function norm(name: string): string {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, "")
    .replace(/^[._]+|[._]+$/g, "");
}

// A mention needs a boundary before '@' (start or a non-handle char) so the
// local part of an email ("a@b.com") isn't treated as a mention — mirrors
// components/linkify-text.tsx. Declared inside the function (not module-scope)
// so concurrent/async callers can't corrupt a shared `lastIndex`.
function mentionRe(): RegExp {
  return /(?:^|[^a-zA-Z0-9_.])@([a-zA-Z0-9_.]{1,30})/g;
}

// Normalized, de-duplicated handles mentioned in a caption.
export function extractMentions(caption: string | null | undefined): string[] {
  if (!caption) return [];
  const out = new Set<string>();
  for (const m of caption.matchAll(mentionRe())) {
    const h = norm(m[1]);
    if (h) out.add(h);
  }
  return [...out];
}

// Clip ids in `channel` whose caption mentions any of `handles`. `handles` is a
// person's whole group (primary + aliases). Scans only clips that contain '@'
// (a few hundred at current scale), then confirms with the boundary-aware regex
// so "@sarahharlow" doesn't spuriously match "@sarahharlowsworld".
export function shortIdsMentioning(handles: string[], channel: string): number[] {
  const set = new Set(handles.map(norm).filter(Boolean));
  if (set.size === 0) return [];
  const rows = db
    .prepare(
      "SELECT id, caption FROM shorts WHERE channel = ? AND is_deleted = 0 AND status = 'ready' AND caption LIKE '%@%'"
    )
    .all(channel) as { id: number; caption: string | null }[];
  const out: number[] = [];
  for (const r of rows) {
    if (extractMentions(r.caption).some((h) => set.has(h))) out.push(r.id);
  }
  return out;
}
