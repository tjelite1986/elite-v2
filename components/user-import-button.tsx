"use client";

import { useState } from "react";
import { FolderInput, Loader2 } from "lucide-react";

// Admin trigger to import every user's per-user `_import` drop tree
// (shorts/main, shorts/18plus, posts, gallery). The host timer runs the same
// scan every few minutes; this button is for an immediate run.
export default function UserImportButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/import/user-folders", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        const parts = [
          `${d.imported ?? 0} file(s)`,
          `${d.users ?? 0} user(s) scanned`,
        ];
        if (d.skipped) parts.push(`${d.skipped} skipped`);
        setMsg(`Imported ${parts.join(", ")}.`);
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
    <div className="mb-8 rounded-2xl border border-white/10 bg-white/5 p-4">
      <h2 className="mb-1 text-lg font-medium">Per-user folder import</h2>
      <p className="mb-3 text-sm text-white/50">
        Sort every user&apos;s dropped files in{" "}
        <code className="rounded bg-white/10 px-1 py-0.5 text-xs">
          u_&lt;user&gt;/_import/
        </code>{" "}
        into their shorts, posts and gallery. Runs automatically every few
        minutes.
      </p>
      <button
        onClick={run}
        disabled={busy}
        className="flex w-fit items-center gap-2 rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold transition active:scale-95 hover:bg-white/15 disabled:opacity-50"
      >
        {busy ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <FolderInput size={16} />
        )}
        {busy ? "Importing…" : "Import now"}
      </button>
      {msg && <p className="mt-2 text-xs text-white/60">{msg}</p>}
    </div>
  );
}
