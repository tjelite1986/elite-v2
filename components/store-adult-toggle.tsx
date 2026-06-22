"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import StoreAdultUnlock from "@/components/store-adult-unlock";

// Entry point to reveal PIN-gated (18+) apps in the store. Adult apps are hidden
// from listings until the shared 18+ gate is unlocked; this gives a way in.
export default function StoreAdultToggle({ unlocked }: { unlocked: boolean }) {
  const [open, setOpen] = useState(false);
  if (unlocked) return null;
  return (
    <div className="mb-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-xs font-medium text-white/60 ring-1 ring-white/10 hover:text-white"
      >
        <Lock className="h-3 w-3 text-rose-400" /> Show 18+ apps
      </button>
      {open && <StoreAdultUnlock />}
    </div>
  );
}
