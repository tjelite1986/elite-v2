"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Link2 } from "lucide-react";

// Admin: scan post-creator folders and link each to Instagram when the folder
// name is a real IG account with the exact same name (100% match). Runs in
// bounded batches; keeps going until there are no more to check.
export default function InstagramAutoConnect() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setMsg("Checking folders against Instagram…");
    let connected = 0;
    let checked = 0;
    try {
      // Loop batches until nothing remains (each batch verifies ~60 accounts).
      for (let i = 0; i < 50; i++) {
        const res = await fetch("/api/instagram/auto-connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ limit: 60 }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) {
          setMsg(d.error || "Auto-connect failed.");
          setBusy(false);
          return;
        }
        connected += d.connected ?? 0;
        checked += d.checked ?? 0;
        setMsg(`Checked ${checked}, connected ${connected}…`);
        if (!d.remaining) break;
      }
      setMsg(`Done — connected ${connected} profile(s) to Instagram (checked ${checked}).`);
      router.refresh();
    } catch {
      setMsg("Auto-connect failed.");
    }
    setBusy(false);
  };

  return (
    <div className="mt-3">
      <button
        onClick={run}
        disabled={busy}
        className="flex w-fit items-center gap-2 rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold transition hover:bg-white/15 active:scale-95 disabled:opacity-50"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}
        Auto-connect folders to Instagram
      </button>
      {msg && <p className="mt-2 text-xs text-white/60">{msg}</p>}
    </div>
  );
}
