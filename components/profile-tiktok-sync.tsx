"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, UserRound } from "lucide-react";

interface TtStatus {
  tiktokHandle: string | null;
  autoPoll: boolean;
  syncing: boolean;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso.replace(" ", "T") + (iso.includes("Z") ? "" : "Z")).getTime();
  const s = Math.floor((Date.now() - then) / 1000);
  if (Number.isNaN(s)) return iso;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Admin/owner widget on a profile that has a TikTok source connected: pull the
// account's media into this profile (videos -> shorts, photos -> posts). No
// session cookie is required.
export default function ProfileTiktokSync({
  handle,
  initial,
}: {
  handle: string;
  initial: TtStatus;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<TtStatus>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/profiles/${encodeURIComponent(handle)}/tiktok-sync`);
    if (r.ok) setStatus(await r.json());
  }, [handle]);

  // Poll while a background sync runs so status + new content refresh live.
  useEffect(() => {
    if (!status.syncing) return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/profiles/${encodeURIComponent(handle)}/tiktok-sync`);
      if (!r.ok) return;
      const next: TtStatus = await r.json();
      setStatus(next);
      if (!next.syncing) router.refresh(); // new posts/shorts landed
    }, 4000);
    return () => clearInterval(t);
  }, [status.syncing, handle, router]);

  const sync = async (mode: "all" | "photos") => {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/profiles/${encodeURIComponent(handle)}/tiktok-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      setMsg(`Sync started (${mode}). New media appears as it downloads.`);
      await refresh();
    } else {
      setMsg(d.error || "Could not start sync.");
    }
    setBusy(false);
  };

  // Metadata only: refresh name/avatar, no media download.
  const syncInfo = async () => {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/profiles/${encodeURIComponent(handle)}/tiktok-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "info" }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      setMsg(d.fetched ? "Profile info updated from TikTok." : "Couldn't fetch info (account private or unavailable).");
      router.refresh();
    } else {
      setMsg(d.error || "Could not fetch info.");
    }
    setBusy(false);
  };

  if (!status.tiktokHandle) return null;

  return (
    <div className="mb-5 rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">
          TikTok: @{status.tiktokHandle}
        </span>
        {status.syncing && <Loader2 size={14} className="animate-spin text-sky-400" />}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => sync("all")}
            disabled={busy || status.syncing}
            className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold transition hover:bg-white/15 active:scale-95 disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            Sync from TikTok
          </button>
          <button
            onClick={() => sync("photos")}
            disabled={busy || status.syncing}
            className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold transition hover:bg-white/15 active:scale-95 disabled:opacity-50"
          >
            Photos only
          </button>
          <button
            onClick={syncInfo}
            disabled={busy || status.syncing}
            className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold transition hover:bg-white/15 active:scale-95 disabled:opacity-50"
          >
            <UserRound size={13} /> Sync info
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-white/40">
        {status.autoPoll ? "Auto-poll on · " : ""}synced {timeAgo(status.lastSyncedAt)}
      </p>
      {status.lastSyncError && (
        <p className="mt-0.5 text-xs text-rose-400">{status.lastSyncError}</p>
      )}
      {msg && <p className="mt-0.5 text-xs text-white/60">{msg}</p>}
    </div>
  );
}
