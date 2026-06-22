"use client";

import { useState } from "react";
import { Bookmark, Check, Download } from "lucide-react";
import { cn } from "@/lib/utils";

// Primary action row on the app detail page: Get/Added, Download APK, Save.
export default function StoreAppActions({
  appId,
  initialInstalled,
  initialSaved,
  hasArtifact,
}: {
  appId: number;
  initialInstalled: boolean;
  initialSaved: boolean;
  hasArtifact: boolean;
}) {
  const [installed, setInstalled] = useState(initialInstalled);
  const [saved, setSaved] = useState(initialSaved);
  const [busy, setBusy] = useState(false);

  async function toggleInstall() {
    if (busy) return;
    setBusy(true);
    const next = !installed;
    setInstalled(next);
    try {
      const res = await fetch(`/api/store/${appId}/install`, {
        method: next ? "PUT" : "DELETE",
      });
      if (!res.ok) setInstalled(!next);
    } catch {
      setInstalled(!next);
    } finally {
      setBusy(false);
    }
  }

  async function toggleSave() {
    const next = !saved;
    setSaved(next);
    try {
      const res = await fetch(`/api/store/${appId}/save`, {
        method: next ? "PUT" : "DELETE",
      });
      if (!res.ok) setSaved(!next);
    } catch {
      setSaved(!next);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={toggleInstall}
        disabled={busy}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-5 py-2 text-sm font-semibold transition",
          installed
            ? "bg-white/10 text-white hover:bg-white/15"
            : "bg-white text-black hover:bg-white/90"
        )}
      >
        {installed ? (
          <>
            <Check className="h-4 w-4" /> Added
          </>
        ) : (
          "Get"
        )}
      </button>

      {hasArtifact && (
        <a
          href={`/api/store/${appId}/download`}
          className="inline-flex items-center gap-1.5 rounded-full bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-400"
        >
          <Download className="h-4 w-4" /> APK
        </a>
      )}

      <button
        onClick={toggleSave}
        className="rounded-full bg-white/10 p-2 text-white/70 transition hover:bg-white/15 hover:text-white"
        aria-label={saved ? "Remove from saved" : "Save"}
      >
        <Bookmark className={cn("h-4 w-4", saved && "fill-white text-white")} />
      </button>
    </div>
  );
}
