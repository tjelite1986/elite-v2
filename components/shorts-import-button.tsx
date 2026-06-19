"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FolderInput, Loader2 } from "lucide-react";

// Admin trigger to scan the 18+ import folder on demand. The host systemd timer
// runs the same scan automatically; this button is for immediate sorting.
export default function ShortsImportButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/shorts/import", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg(
          `Imported ${d.imported ?? 0} clip(s), ${d.profilesNew ?? 0} new profile(s), ${d.skipped ?? 0} skipped.`
        );
        router.refresh();
      } else {
        setMsg(d.error || "Import failed.");
      }
    } catch {
      setMsg("Import failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        onClick={run}
        disabled={busy}
        className="flex w-fit items-center gap-2 rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold transition active:scale-95 hover:bg-white/15 disabled:opacity-50"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <FolderInput size={16} />}
        {busy ? "Importing…" : "Import now"}
      </button>
      {msg && <p className="text-xs text-white/60">{msg}</p>}
    </div>
  );
}
