"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ScanSearch, Trash2, FileX2 } from "lucide-react";

interface Orphan {
  id: number;
  user_id: number;
  filename: string;
  storage_key: string;
  owner_name: string | null;
  taken_at: string;
}

// Admin tool: find gallery items whose original file is gone from disk (the
// thumbnail may still show in the grid but every full load 404s), then remove
// them in one click. Removing an orphan is always safe — there's no file left to
// keep — so it's a flat list, not a keep/delete picker. The gallery has no parent
// "post", so there's no empty-parent half (unlike the posts cleanup tool).
export default function GalleryCleanup() {
  const router = useRouter();
  const [orphans, setOrphans] = useState<Orphan[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const scan = useCallback(async () => {
    setScanning(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/gallery/maintenance`);
      if (!res.ok) {
        setMsg("Scan failed.");
        return;
      }
      const d = await res.json();
      setOrphans(d.orphans || []);
    } catch {
      setMsg("Scan failed.");
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    scan();
  }, [scan]);

  const removeOrphans = async () => {
    if (!orphans || orphans.length === 0) return;
    if (
      !window.confirm(
        `Remove ${orphans.length} items whose file is missing? They can't be shown anyway.`
      )
    )
      return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/gallery/maintenance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "orphans" }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg(`Removed ${d.deleted ?? 0} broken items.`);
        await scan();
        router.refresh();
      } else {
        setMsg(d.error || "Cleanup failed.");
      }
    } catch {
      setMsg("Cleanup failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-8">
      <h2 className="mb-1 text-lg font-semibold">Cleanup</h2>
      <p className="mb-3 text-sm text-white/50">
        Find gallery items whose original file is missing on disk (they still
        appear but won&apos;t load), then remove the dead entries.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={scan}
          disabled={scanning || busy}
          className="flex w-fit items-center gap-2 rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold transition active:scale-95 hover:bg-white/15 disabled:opacity-50"
        >
          {scanning ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <ScanSearch size={16} />
          )}
          {scanning ? "Scanning…" : "Rescan"}
        </button>

        {orphans && orphans.length > 0 && (
          <button
            onClick={removeOrphans}
            disabled={busy}
            className="flex w-fit items-center gap-2 rounded-full bg-rose-500/90 px-5 py-2.5 text-sm font-semibold transition active:scale-95 hover:bg-rose-500 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <FileX2 size={16} />
            )}
            Remove {orphans.length} missing
          </button>
        )}
      </div>

      {msg && <p className="mt-2 text-xs text-white/60">{msg}</p>}

      {orphans && orphans.length === 0 && (
        <p className="mt-4 text-sm text-white/40">
          Nothing to clean — every item has its file.
        </p>
      )}

      {orphans && orphans.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-white/40">
            Missing files ({orphans.length})
          </p>
          <ul className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-white/5">
            {orphans.map((o) => (
              <li
                key={o.id}
                className="flex items-center gap-2 px-3 py-2 text-xs text-white/70"
              >
                <Trash2 size={13} className="shrink-0 text-rose-300/70" />
                <span className="text-white/40">#{o.id}</span>
                <span className="truncate">{o.filename || o.storage_key}</span>
                {o.owner_name && (
                  <span className="ml-auto truncate text-white/30">
                    @{o.owner_name}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
