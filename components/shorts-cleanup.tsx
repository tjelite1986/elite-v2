"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ScanSearch, Trash2, FileX2, ListX } from "lucide-react";

interface Orphan {
  id: number;
  channel: "main" | "18plus";
  caption: string | null;
  profile_name: string | null;
  storage_key: string;
  created_at: string;
}

interface EmptyPlaylist {
  id: number;
  name: string;
  user_email: string | null;
}

// Admin tool: find shorts whose video file is gone from disk (they still show in
// feeds/grids/playlists but every play 404s) and playlists that no longer hold a
// single visible clip, then remove them in one click. Removing an orphan is
// always safe — there's no file left to keep — so unlike the duplicate tool it's
// a flat list, not a keep/delete picker.
export default function ShortsCleanup({
  channel,
}: {
  channel: "main" | "18plus";
}) {
  const router = useRouter();
  const [orphans, setOrphans] = useState<Orphan[] | null>(null);
  const [playlists, setPlaylists] = useState<EmptyPlaylist[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState<null | "orphans" | "playlists">(null);
  const [msg, setMsg] = useState<string | null>(null);

  const scan = useCallback(async () => {
    setScanning(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/shorts/maintenance?channel=${channel}`);
      if (!res.ok) {
        setMsg("Scan failed.");
        return;
      }
      const d = await res.json();
      setOrphans(d.orphans || []);
      setPlaylists(d.emptyPlaylists || []);
    } catch {
      setMsg("Scan failed.");
    } finally {
      setScanning(false);
    }
  }, [channel]);

  useEffect(() => {
    scan();
  }, [scan]);

  const removeOrphans = async () => {
    if (!orphans || orphans.length === 0) return;
    if (
      !window.confirm(
        `Ta bort ${orphans.length} klipp vars fil saknas? De går inte att spela ändå.`
      )
    )
      return;
    setBusy("orphans");
    setMsg(null);
    try {
      const res = await fetch(`/api/shorts/maintenance?channel=${channel}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "orphans" }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg(`Tog bort ${d.deleted ?? 0} trasiga klipp.`);
        await scan();
        router.refresh();
      } else {
        setMsg(d.error || "Cleanup failed.");
      }
    } catch {
      setMsg("Cleanup failed.");
    } finally {
      setBusy(null);
    }
  };

  const removePlaylists = async () => {
    if (!playlists || playlists.length === 0) return;
    if (!window.confirm(`Ta bort ${playlists.length} tomma spellistor?`)) return;
    setBusy("playlists");
    setMsg(null);
    try {
      const res = await fetch(`/api/shorts/maintenance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "playlists" }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg(`Tog bort ${d.deleted ?? 0} tomma spellistor.`);
        await scan();
        router.refresh();
      } else {
        setMsg(d.error || "Cleanup failed.");
      }
    } catch {
      setMsg("Cleanup failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mb-8">
      <h2 className="mb-1 text-lg font-semibold">Cleanup</h2>
      <p className="mb-3 text-sm text-white/50">
        Find clips whose video file is missing on disk (they still appear but
        won&apos;t play) and playlists left with no playable clip, then remove the
        dead entries.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={scan}
          disabled={scanning || busy !== null}
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
            disabled={busy !== null}
            className="flex w-fit items-center gap-2 rounded-full bg-rose-500/90 px-5 py-2.5 text-sm font-semibold transition active:scale-95 hover:bg-rose-500 disabled:opacity-50"
          >
            {busy === "orphans" ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <FileX2 size={16} />
            )}
            Remove {orphans.length} missing
          </button>
        )}

        {playlists && playlists.length > 0 && (
          <button
            onClick={removePlaylists}
            disabled={busy !== null}
            className="flex w-fit items-center gap-2 rounded-full bg-rose-500/90 px-5 py-2.5 text-sm font-semibold transition active:scale-95 hover:bg-rose-500 disabled:opacity-50"
          >
            {busy === "playlists" ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <ListX size={16} />
            )}
            Remove {playlists.length} empty playlists
          </button>
        )}
      </div>

      {msg && <p className="mt-2 text-xs text-white/60">{msg}</p>}

      {orphans && playlists && orphans.length === 0 && playlists.length === 0 && (
        <p className="mt-4 text-sm text-white/40">
          Nothing to clean — every clip has its file and no playlist is empty.
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
                <span className="truncate">
                  {o.caption || o.profile_name || o.storage_key}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {playlists && playlists.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-white/40">
            Empty playlists ({playlists.length})
          </p>
          <ul className="divide-y divide-white/5 rounded-2xl border border-white/10 bg-white/5">
            {playlists.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-2 px-3 py-2 text-xs text-white/70"
              >
                <ListX size={13} className="shrink-0 text-rose-300/70" />
                <span className="truncate">{p.name}</span>
                {p.user_email && (
                  <span className="ml-auto truncate text-white/30">
                    {p.user_email}
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
