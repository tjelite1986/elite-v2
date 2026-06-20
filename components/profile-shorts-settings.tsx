"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RefreshCw, Download, Loader2 } from "lucide-react";

interface ChannelSettings {
  id: number;
  channel: "main" | "18plus";
  autoPoll: boolean;
  basePath: string; // /shorts or /shorts18
}

// Admin shorts controls on a person's profile: auto-poll on/off, Poll now, and a
// link to the per-profile download (candidates) browser — the same actions as
// the Shorts settings page, reusing the existing /api/shorts/profiles APIs.
export default function ProfileShortsSettings({
  channels,
}: {
  channels: ChannelSettings[];
}) {
  if (channels.length === 0) return null;
  return (
    <div className="mt-2 space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
      <h2 className="text-sm font-semibold text-white/80">Shorts settings (admin)</h2>
      {channels.map((c) => (
        <ChannelRow key={c.id} settings={c} />
      ))}
    </div>
  );
}

function ChannelRow({ settings }: { settings: ChannelSettings }) {
  const router = useRouter();
  const [autoPoll, setAutoPoll] = useState(settings.autoPoll);
  const [savingToggle, setSavingToggle] = useState(false);
  const [polling, setPolling] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const toggle = async () => {
    const next = !autoPoll;
    setAutoPoll(next);
    setSavingToggle(true);
    const res = await fetch(`/api/shorts/profiles/${settings.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auto_poll: next }),
    });
    if (!res.ok) setAutoPoll(!next);
    setSavingToggle(false);
    router.refresh();
  };

  const pollNow = async () => {
    setPolling(true);
    setMsg(null);
    const res = await fetch(`/api/shorts/profiles/${settings.id}/poll`, { method: "POST" });
    setMsg(res.ok ? "Polling started…" : "Poll failed.");
    setPolling(false);
    setTimeout(() => setMsg(null), 3000);
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm font-medium">
        {settings.channel === "18plus" ? "Shorts 18+" : "Shorts"}
      </span>

      <button
        type="button"
        role="switch"
        aria-checked={autoPoll}
        onClick={toggle}
        disabled={savingToggle}
        className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
          autoPoll ? "bg-rose-500" : "bg-white/20"
        }`}
        title="Auto-poll"
      >
        <span
          className={`absolute top-1 size-4 rounded-full bg-white transition-all ${
            autoPoll ? "left-6" : "left-1"
          }`}
        />
      </button>
      <span className="text-xs text-white/50">Auto-poll</span>

      <button
        onClick={pollNow}
        disabled={polling}
        className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold transition hover:bg-white/15 disabled:opacity-50"
      >
        {polling ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        Poll now
      </button>

      <Link
        href={`${settings.basePath}/profile/${settings.id}/candidates`}
        className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold transition hover:bg-white/15"
      >
        <Download size={13} /> Download
      </Link>

      {msg && <span className="text-xs text-white/60">{msg}</span>}
    </div>
  );
}
