"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";

// PIN prompt for the 18+ channel. On success the unlock route sets the gate
// cookie and we refresh so the server component re-renders with the feed.
export default function Shorts18Gate({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/shorts/18/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Incorrect PIN");
    } catch {
      setError("Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col items-center justify-center px-6 text-white">
      <div className="w-full max-w-sm rounded-2xl bg-white/5 p-8 text-center ring-1 ring-white/10">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-rose-500/20 text-rose-400">
          <Lock size={28} />
        </div>
        <h1 className="text-lg font-semibold">Adult channel</h1>
        <p className="mt-1 text-sm text-white/60">
          {configured
            ? "Enter the PIN to continue."
            : "This channel is not configured yet."}
        </p>

        {configured && (
          <form onSubmit={submit} className="mt-6 space-y-3">
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="PIN"
              className="w-full rounded-full bg-white/10 px-5 py-3 text-center text-sm tracking-widest placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-rose-400"
            />
            {error && <p className="text-sm text-rose-400">{error}</p>}
            <button
              type="submit"
              disabled={busy || !pin}
              className="w-full rounded-full bg-rose-500 py-3 text-sm font-semibold text-white transition active:scale-95 disabled:opacity-50"
            >
              {busy ? "Checking…" : "Unlock"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
