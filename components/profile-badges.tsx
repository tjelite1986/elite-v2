"use client";

import {
  Award,
  Camera,
  Clapperboard,
  Heart,
  Images,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { PersonBadge } from "@/lib/directory";

const ICONS: Record<string, LucideIcon> = {
  Sparkles,
  Camera,
  Images,
  Clapperboard,
  Users,
  Heart,
};

// Earned achievement badges as labeled chips with a tooltip describing each.
export default function ProfileBadges({ badges }: { badges: PersonBadge[] }) {
  if (badges.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {badges.map((b) => {
        const Icon = ICONS[b.icon] ?? Award;
        return (
          <span
            key={b.id}
            title={b.description}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-xs font-medium ring-1 ring-white/10"
          >
            <Icon size={13} className={b.color} />
            {b.name}
          </span>
        );
      })}
    </div>
  );
}
