import { db } from "./db";

// Auto-earned achievement badges. Definitions are static; thresholds are checked
// against a user's current stats whenever their profile is resolved, and newly
// satisfied badges are persisted in user_badges (so earned_at is stable).

export interface BadgeDef {
  id: string;
  name: string;
  description: string;
  // Lucide icon name (mapped to a component in components/profile-badges.tsx).
  icon: string;
  // Tailwind text colour class for the chip.
  color: string;
  // Whether the user's stats currently satisfy this badge.
  earned: (s: Stats) => boolean;
}

interface Stats {
  userId: number;
  photos: number;
  shorts: number;
  followers: number;
  likes: number;
}

export const BADGES: BadgeDef[] = [
  {
    id: "early_member",
    name: "Early member",
    description: "One of the first members of Elite.",
    icon: "Sparkles",
    color: "text-purple-300",
    earned: (s) => s.userId > 0 && s.userId <= 25,
  },
  {
    id: "shutterbug",
    name: "Shutterbug",
    description: "Uploaded 50 photos.",
    icon: "Camera",
    color: "text-blue-300",
    earned: (s) => s.photos >= 50,
  },
  {
    id: "archivist",
    name: "Archivist",
    description: "Uploaded 250 photos.",
    icon: "Images",
    color: "text-cyan-300",
    earned: (s) => s.photos >= 250,
  },
  {
    id: "creator",
    name: "Creator",
    description: "Posted 10 shorts.",
    icon: "Clapperboard",
    color: "text-rose-300",
    earned: (s) => s.shorts >= 10,
  },
  {
    id: "connected",
    name: "Connected",
    description: "Reached 10 followers.",
    icon: "Users",
    color: "text-green-300",
    earned: (s) => s.followers >= 10,
  },
  {
    id: "crowd_pleaser",
    name: "Crowd-pleaser",
    description: "Earned 100 likes on your shorts.",
    icon: "Heart",
    color: "text-pink-300",
    earned: (s) => s.likes >= 100,
  },
];

const BY_ID = new Map(BADGES.map((b) => [b.id, b]));

function statsFor(userId: number): Stats {
  const one = (sql: string, ...args: unknown[]) =>
    (db.prepare(sql).get(...args) as { c: number } | undefined)?.c ?? 0;
  return {
    userId,
    photos: one(
      "SELECT COUNT(*) c FROM gallery_items WHERE user_id = ? AND is_deleted = 0",
      userId
    ),
    shorts: one(
      "SELECT COUNT(*) c FROM shorts WHERE uploader_id = ? AND is_deleted = 0",
      userId
    ),
    followers: one(
      "SELECT COUNT(*) c FROM follows WHERE target_type = 'user' AND target_id = ?",
      userId
    ),
    likes: one(
      "SELECT COUNT(*) c FROM short_likes sl JOIN shorts s ON s.id = sl.short_id WHERE s.uploader_id = ?",
      userId
    ),
  };
}

export interface EarnedBadge extends BadgeDef {
  earned_at: string;
}

// Award any newly-earned badges, then return the user's earned badges (in the
// canonical BADGES order) joined with their earned_at.
export function resolveBadges(userId: number): EarnedBadge[] {
  if (!userId) return [];
  const stats = statsFor(userId);
  const insert = db.prepare(
    "INSERT OR IGNORE INTO user_badges (user_id, badge_id) VALUES (?, ?)"
  );
  for (const b of BADGES) {
    if (b.earned(stats)) insert.run(userId, b.id);
  }
  const rows = db
    .prepare("SELECT badge_id, earned_at FROM user_badges WHERE user_id = ?")
    .all(userId) as { badge_id: string; earned_at: string }[];
  const earnedAt = new Map(rows.map((r) => [r.badge_id, r.earned_at]));
  return BADGES.filter((b) => earnedAt.has(b.id)).map((b) => ({
    ...b,
    earned_at: earnedAt.get(b.id)!,
  }));
}

export type { Stats };
export { BY_ID };
