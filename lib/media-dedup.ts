import { db } from "./db";
import type { ShortChannel, VideoChannel } from "./db";
import { videoPathFor } from "./shorts-storage";
import { videoFilePath } from "./videos-storage";
import { deleteShortFiles } from "./shorts-storage";
import { deleteVideo } from "./videos";
import {
  compareFingerprints,
  fingerprintVideo,
  type MatchVerdict,
} from "./media-fingerprint";

// ---------------------------------------------------------------------------
// Duplicate detection from whole-clip fingerprints.
//
// The existing shorts dupe scan groups on exact and per-frame perceptual
// matches. This is the complement: a signature of how a clip PROGRESSES, which
// survives re-encoding, rescaling and watermarking, and catches the case where
// the same scene was uploaded twice from different sources.
//
// Fingerprinting is ffmpeg-only — no API calls, no cost per item — so unlike
// the summaries this can run over the whole library freely.
// ---------------------------------------------------------------------------

export type MediaKind = "short" | "video";

export interface FingerprintRow {
  kind: MediaKind;
  media_id: number;
  dhash: string;
  colors: string;
  frames: number;
  duration: number | null;
  created_at: string;
}

interface PendingItem {
  id: number;
  path: string;
  duration: number | null;
}

function pendingShorts(limit: number): PendingItem[] {
  const rows = db
    .prepare(
      `SELECT s.id, s.channel, s.storage_key, s.duration
         FROM shorts s
         LEFT JOIN media_fingerprints f
                ON f.kind = 'short' AND f.media_id = s.id
        WHERE f.media_id IS NULL
          AND s.is_deleted = 0
          AND s.status = 'ready'
        ORDER BY s.created_at DESC
        LIMIT ?`
    )
    .all(limit) as {
    id: number;
    channel: ShortChannel;
    storage_key: string;
    duration: number | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    path: videoPathFor(r.channel, r.storage_key),
    duration: r.duration,
  }));
}

function pendingVideos(limit: number): PendingItem[] {
  const rows = db
    .prepare(
      `SELECT v.id, v.channel, v.storage_key, v.duration
         FROM videos v
         LEFT JOIN media_fingerprints f
                ON f.kind = 'video' AND f.media_id = v.id
        WHERE f.media_id IS NULL
          AND v.playable = 1
        ORDER BY v.added_at DESC
        LIMIT ?`
    )
    .all(limit) as {
    id: number;
    channel: VideoChannel;
    storage_key: string;
    duration: number | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    path: videoFilePath(r.channel, r.storage_key),
    duration: r.duration,
  }));
}

export function pendingFingerprints(): { shorts: number; videos: number } {
  const shorts = db
    .prepare(
      `SELECT COUNT(*) AS n FROM shorts s
         LEFT JOIN media_fingerprints f
                ON f.kind = 'short' AND f.media_id = s.id
        WHERE f.media_id IS NULL AND s.is_deleted = 0 AND s.status = 'ready'`
    )
    .get() as { n: number };
  const videos = db
    .prepare(
      `SELECT COUNT(*) AS n FROM videos v
         LEFT JOIN media_fingerprints f
                ON f.kind = 'video' AND f.media_id = v.id
        WHERE f.media_id IS NULL AND v.playable = 1`
    )
    .get() as { n: number };
  return { shorts: shorts.n, videos: videos.n };
}

let running = false;
let lastRun: {
  finishedAt: string;
  fingerprinted: number;
  skipped: number;
} | null = null;

export function fingerprintState(): {
  running: boolean;
  pending: { shorts: number; videos: number };
  stored: number;
  lastRun: typeof lastRun;
} {
  const stored = db
    .prepare("SELECT COUNT(*) AS n FROM media_fingerprints")
    .get() as { n: number };
  return { running, pending: pendingFingerprints(), stored: stored.n, lastRun };
}

/**
 * Work the fingerprint backlog until the budget runs out. Pure ffmpeg, so this
 * competes with the transcode queue for CPU — hence the modest default budget
 * and the nice level inside the sampler.
 */
export async function fingerprintPending(
  budgetMs = 10 * 60_000
): Promise<{ fingerprinted: number; skipped: number; remaining: number }> {
  if (running) {
    const p = pendingFingerprints();
    return { fingerprinted: 0, skipped: 0, remaining: p.shorts + p.videos };
  }
  running = true;
  const deadline = Date.now() + budgetMs;
  let fingerprinted = 0;
  let skipped = 0;

  const insert = db.prepare(
    `INSERT OR REPLACE INTO media_fingerprints
       (kind, media_id, dhash, colors, frames, duration)
     VALUES (@kind, @media_id, @dhash, @colors, @frames, @duration)`
  );

  try {
    for (const kind of ["short", "video"] as const) {
      for (;;) {
        if (Date.now() >= deadline) break;
        const batch =
          kind === "short" ? pendingShorts(1) : pendingVideos(1);
        const item = batch[0];
        if (!item) break;

        const fp = await fingerprintVideo(item.path, item.duration);
        if (!fp) {
          // Unreadable: store an empty marker so the queue does not retry it
          // forever. It will never match anything, which is correct.
          insert.run({
            kind,
            media_id: item.id,
            dhash: "",
            colors: "",
            frames: 0,
            duration: item.duration,
          });
          skipped++;
          continue;
        }
        insert.run({
          kind,
          media_id: item.id,
          dhash: fp.dhash,
          colors: fp.colors,
          frames: fp.frames,
          duration: item.duration,
        });
        fingerprinted++;
      }
    }
  } finally {
    running = false;
  }

  const p = pendingFingerprints();
  lastRun = {
    finishedAt: new Date().toISOString(),
    fingerprinted,
    skipped,
  };
  return { fingerprinted, skipped, remaining: p.shorts + p.videos };
}

export function startFingerprintRun(budgetMs?: number): {
  started: boolean;
  message: string;
} {
  if (running) {
    return { started: false, message: "A fingerprint run is already going." };
  }
  const p = pendingFingerprints();
  if (p.shorts + p.videos === 0) {
    return { started: false, message: "Everything is fingerprinted." };
  }
  void fingerprintPending(budgetMs).catch(() => {
    /* lastRun stays as it was; the next run retries */
  });
  return {
    started: true,
    message: `Fingerprinting ${p.shorts + p.videos} item(s) in the background.`,
  };
}

// --- dismissals -------------------------------------------------------------

/** Pair key, order-independent so (a,b) and (b,a) are the same judgement. */
function pairKey(a: number, b: number): [number, number] {
  return a < b ? [a, b] : [b, a];
}

export function dismissPair(kind: MediaKind, a: number, b: number): void {
  const [lo, hi] = pairKey(a, b);
  db.prepare(
    `INSERT OR IGNORE INTO media_dupe_dismissals (kind, a_id, b_id)
     VALUES (?, ?, ?)`
  ).run(kind, lo, hi);
}

export function undismissPair(kind: MediaKind, a: number, b: number): void {
  const [lo, hi] = pairKey(a, b);
  db.prepare(
    "DELETE FROM media_dupe_dismissals WHERE kind = ? AND a_id = ? AND b_id = ?"
  ).run(kind, lo, hi);
}

function dismissedSet(kind: MediaKind): Set<string> {
  const rows = db
    .prepare("SELECT a_id, b_id FROM media_dupe_dismissals WHERE kind = ?")
    .all(kind) as { a_id: number; b_id: number }[];
  return new Set(rows.map((r) => `${r.a_id}:${r.b_id}`));
}

export function dismissedCount(kind: MediaKind): number {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n FROM media_dupe_dismissals WHERE kind = ?"
    )
    .get(kind) as { n: number };
  return row.n;
}

// --- deletion ---------------------------------------------------------------

export interface DeleteResult {
  deleted: number;
  skipped: number;
  message: string;
}

/**
 * Delete duplicate members. Refuses to empty a group: the caller must always
 * leave at least one copy, so a mis-click cannot take the last surviving file
 * along with its duplicates.
 */
export function deleteDuplicateMembers(
  kind: MediaKind,
  ids: number[],
  groupMembers: number[]
): DeleteResult {
  const wanted = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
  const survivors = groupMembers.filter((id) => !wanted.includes(id));
  if (survivors.length === 0) {
    return {
      deleted: 0,
      skipped: wanted.length,
      message: "Refusing to delete every copy — keep at least one.",
    };
  }

  let deleted = 0;
  let skipped = 0;

  for (const id of wanted) {
    if (kind === "short") {
      const clip = db
        .prepare(
          "SELECT id, channel, storage_key, poster_key FROM shorts WHERE id = ? AND is_deleted = 0"
        )
        .get(id) as
        | {
            id: number;
            channel: ShortChannel;
            storage_key: string;
            poster_key: string | null;
          }
        | undefined;
      if (!clip) {
        skipped++;
        continue;
      }
      // Soft-delete FIRST, then unlink: the reverse order can lose the files
      // to a crash between the two calls while the row stays visible and
      // serveable with nothing on disk (matches the `97889f6` fix applied to
      // every other shorts deletion path).
      db.prepare("UPDATE shorts SET is_deleted = 1 WHERE id = ?").run(id);
      db.prepare(
        "DELETE FROM media_fingerprints WHERE kind = ? AND media_id = ?"
      ).run(kind, id);
      deleteShortFiles(clip.channel, clip.storage_key, clip.poster_key);
      deleted++;
    } else {
      if (!deleteVideo(id, true)) {
        skipped++;
        continue;
      }
      db.prepare(
        "DELETE FROM media_fingerprints WHERE kind = ? AND media_id = ?"
      ).run(kind, id);
      deleted++;
    }
  }

  return {
    deleted,
    skipped,
    message: `${deleted} deleted${skipped ? `, ${skipped} skipped` : ""}.`,
  };
}

export interface DuplicateMatch {
  kind: MediaKind;
  a: number;
  b: number;
  verdict: MatchVerdict;
}

/**
 * Compare every stored fingerprint of one kind against every other.
 *
 * O(n^2), but cheap per pair (a table lookup per hex digit) and bounded by a
 * duration pre-filter: duplicates run within a few percent of each other's
 * length, so clips of obviously different lengths never reach the comparison.
 * At library scale this is a few hundred milliseconds, not a job.
 */
export function findDuplicates(
  kind: MediaKind,
  options: { includeRecolored?: boolean } = {}
): DuplicateMatch[] {
  const rows = db
    .prepare(
      `SELECT media_id, dhash, colors, duration
         FROM media_fingerprints
        WHERE kind = ? AND dhash <> ''
        ORDER BY media_id`
    )
    .all(kind) as {
    media_id: number;
    dhash: string;
    colors: string;
    duration: number | null;
  }[];

  const dismissed = dismissedSet(kind);
  const matches: DuplicateMatch[] = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];

      // A pair a human has already judged is never re-offered.
      const [lo, hi] = pairKey(a.media_id, b.media_id);
      if (dismissed.has(`${lo}:${hi}`)) continue;

      // Length pre-filter: a re-encode keeps the running time, so anything
      // more than 5% apart cannot be the same clip and is not worth hashing.
      if (a.duration && b.duration) {
        const longer = Math.max(a.duration, b.duration);
        if (Math.abs(a.duration - b.duration) / longer > 0.05) continue;
      }

      const verdict = compareFingerprints(a, b);
      if (verdict.isDuplicate || (options.includeRecolored && verdict.isRecolored)) {
        matches.push({
          kind,
          a: a.media_id,
          b: b.media_id,
          verdict,
        });
      }
    }
  }
  return matches;
}

export interface DuplicateGroup {
  kind: MediaKind;
  members: number[];
  /** Lowest similarity within the group, so a loose group is visible as such. */
  minSimilarity: number;
  recoloredOnly: boolean;
}

/** Collapse pairwise matches into groups via union-find. */
export function duplicateGroups(
  kind: MediaKind,
  options: { includeRecolored?: boolean } = {}
): DuplicateGroup[] {
  const matches = findDuplicates(kind, options);
  const parent = new Map<number, number>();

  const find = (x: number): number => {
    if (!parent.has(x)) parent.set(x, x);
    let root = parent.get(x) as number;
    while (root !== parent.get(root)) root = parent.get(root) as number;
    parent.set(x, root);
    return root;
  };
  const union = (x: number, y: number) => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent.set(rx, ry);
  };

  for (const m of matches) union(m.a, m.b);

  const groups = new Map<number, { members: Set<number>; min: number; recolored: boolean }>();
  for (const m of matches) {
    const root = find(m.a);
    const entry =
      groups.get(root) ??
      { members: new Set<number>(), min: 1, recolored: true };
    entry.members.add(m.a);
    entry.members.add(m.b);
    entry.min = Math.min(entry.min, m.verdict.similarity);
    if (m.verdict.isDuplicate) entry.recolored = false;
    groups.set(root, entry);
  }

  return [...groups.values()]
    .map((g) => ({
      kind,
      members: [...g.members].sort((x, y) => x - y),
      minSimilarity: g.min,
      recoloredOnly: g.recolored,
    }))
    .sort((a, b) => b.members.length - a.members.length);
}
