"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FolderInput, Loader2 } from "lucide-react";

// Admin trigger to sort the posts _import folder into creator profiles. The host
// timer runs the same scan automatically; this button is for immediate sorting.
export default function PostsImportButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/posts/import", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg(
          `Imported ${d.imported ?? 0} image(s), ${d.creatorsNew ?? 0} new creator(s), ${d.skipped ?? 0} skipped.`
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
    <div className="mb-4 rounded-2xl border border-white/10 bg-white/5 p-3">
      <button
        onClick={run}
        disabled={busy}
        className="flex w-fit items-center gap-2 rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold transition active:scale-95 hover:bg-white/15 disabled:opacity-50"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <FolderInput size={16} />}
        {busy ? "Importing…" : "Import dropped photos"}
      </button>
      {msg && <p className="mt-2 text-xs text-white/60">{msg}</p>}
    </div>
  );
}
