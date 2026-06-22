"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";

// PIN prompt for adult apps. Reuses the shared 18+ gate endpoint, so unlocking
// here also unlocks Shorts 18+ (same signed cookie).
export default function StoreAdultUnlock() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/shorts/18/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        const json = await res.json().catch(() => ({}));
        setError(json.error || "Incorrect PIN");
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-10 max-w-sm rounded-3xl bg-white/[0.04] p-8 text-center ring-1 ring-white/10">
      <Lock className="mx-auto mb-3 h-8 w-8 text-rose-400" />
      <h2 className="text-lg font-bold text-white">Adult content</h2>
      <p className="mb-4 mt-1 text-sm text-white/60">
        Enter the PIN to view this app.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <input
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="PIN"
          className="w-full rounded-xl bg-black/30 px-4 py-2 text-center text-white outline-none ring-1 ring-white/10"
          autoFocus
        />
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <button
          type="submit"
          disabled={busy || !pin}
          className="w-full rounded-full bg-white py-2 text-sm font-semibold text-black disabled:opacity-40"
        >
          Unlock
        </button>
      </form>
    </div>
  );
}
