"use client";

import { useState } from "react";
import Link from "next/link";
import { Bookmark, Check, Download, Lock } from "lucide-react";
import type { AppCard } from "@/lib/store";
import StoreStars from "@/components/store-stars";
import { cn } from "@/lib/utils";

// One app in a grid/shelf. Handles optimistic install + save toggles.
export default function StoreAppCard({
  app,
  variant = "tile",
}: {
  app: AppCard;
  variant?: "tile" | "row";
}) {
  const [installed, setInstalled] = useState(app.installed);
  const [saved, setSaved] = useState(app.saved);
  const [busy, setBusy] = useState(false);

  async function toggleInstall(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    const next = !installed;
    setInstalled(next);
    try {
      const res = await fetch(`/api/store/${app.id}/install`, {
        method: next ? "PUT" : "DELETE",
      });
      if (!res.ok) setInstalled(!next);
    } catch {
      setInstalled(!next);
    } finally {
      setBusy(false);
    }
  }

  async function toggleSave(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const next = !saved;
    setSaved(next);
    try {
      const res = await fetch(`/api/store/${app.id}/save`, {
        method: next ? "PUT" : "DELETE",
      });
      if (!res.ok) setSaved(!next);
    } catch {
      setSaved(!next);
    }
  }

  return (
    <Link
      href={`/store/${app.slug}`}
      className={cn(
        "group relative flex rounded-2xl bg-white/[0.04] ring-1 ring-white/10 transition hover:bg-white/[0.07]",
        variant === "tile"
          ? "w-40 shrink-0 flex-col p-3"
          : "w-full items-center gap-3 p-3"
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={app.iconUrl}
        alt=""
        className={cn(
          "rounded-xl bg-white/5 object-cover ring-1 ring-white/10",
          variant === "tile" ? "mb-2 h-20 w-20" : "h-14 w-14"
        )}
        loading="lazy"
      />
      <div className={cn("min-w-0", variant === "row" && "flex-1")}>
        <div className="flex items-center gap-1">
          <p className="truncate text-sm font-semibold text-white">{app.name}</p>
          {app.requiresPin && <Lock className="h-3 w-3 shrink-0 text-rose-400" />}
        </div>
        <p className="truncate text-xs text-white/50">
          {app.developer || app.category}
        </p>
        <div className="mt-1">
          <StoreStars value={app.ratingAvg} count={app.ratingCount} size={12} />
        </div>
      </div>

      <div
        className={cn(
          "flex items-center gap-1",
          variant === "tile" && "mt-2 justify-between"
        )}
      >
        <button
          onClick={toggleInstall}
          disabled={busy}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold transition",
            installed
              ? "bg-white/10 text-white/70 hover:bg-white/15"
              : "bg-white text-black hover:bg-white/90"
          )}
        >
          {installed ? (
            <>
              <Check className="h-3 w-3" /> Added
            </>
          ) : (
            <>
              <Download className="h-3 w-3" /> Get
            </>
          )}
        </button>
        <button
          onClick={toggleSave}
          className="rounded-full p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
          aria-label={saved ? "Remove from saved" : "Save"}
        >
          <Bookmark className={cn("h-4 w-4", saved && "fill-white text-white")} />
        </button>
      </div>
    </Link>
  );
}
