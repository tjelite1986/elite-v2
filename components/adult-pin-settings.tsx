"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const inputCls =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/30";
const btnCls = "rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50";

// Per-user OPTIONAL 18+ PIN. With no PIN adult content is open; setting one locks
// the 18+ surfaces on this account behind it.
export default function AdultPinSettings({ hasPin: initial }: { hasPin: boolean }) {
  const router = useRouter();
  const [hasPin, setHasPin] = useState(initial);
  const [pin, setPin] = useState("");
  const [current, setCurrent] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function call(method: "PUT" | "DELETE", body: Record<string, string>) {
    setErr("");
    setMsg("");
    setBusy(true);
    try {
      const r = await fetch("/api/account/adult-pin", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Failed");
      setHasPin(!!d.hasPin);
      setPin("");
      setCurrent("");
      setMsg(method === "DELETE" ? "PIN removed — adult content is open again." : "PIN saved.");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-8">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-medium">18+ PIN lock</h2>
        {hasPin && (
          <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-xs text-rose-300">on</span>
        )}
      </div>
      <p className="mt-1 max-w-md text-sm text-white/50">
        Adult content is open by default. Set a personal PIN to lock the 18+
        surfaces (Shorts 18+, adult posts &amp; apps) on your account — you&apos;ll
        enter it once per 2 hours per device.
      </p>

      <div className="mt-4 flex max-w-xs flex-col gap-2">
        {hasPin && (
          <input
            type="password"
            inputMode="numeric"
            placeholder="Current PIN"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className={inputCls}
            autoComplete="off"
          />
        )}
        <input
          type="password"
          placeholder={hasPin ? "New PIN" : "PIN (min 4 characters)"}
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          className={inputCls}
          autoComplete="off"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => call("PUT", { pin, current })}
            disabled={busy || pin.length < 4 || (hasPin && !current)}
            className={`${btnCls} bg-rose-500 text-white hover:bg-rose-400`}
          >
            {hasPin ? "Change PIN" : "Set PIN"}
          </button>
          {hasPin && (
            <button
              type="button"
              onClick={() => call("DELETE", { current })}
              disabled={busy || !current}
              className={`${btnCls} bg-white/10 text-white/80 hover:bg-white/15`}
            >
              Remove PIN
            </button>
          )}
        </div>
        {msg && <p className="text-sm text-emerald-400">{msg}</p>}
        {err && <p className="text-sm text-rose-400">{err}</p>}
      </div>
    </div>
  );
}
